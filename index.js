"use strict";

// Getting the required packages
const AWS = require("aws-sdk");
const CryptoJS = require("crypto-js");
const docClient = new AWS.DynamoDB.DocumentClient({ region: "eu-west-1" });
const dns = require('dns').promises;

console.log("AWS Lambda SES Forwarder");

// Expected environment variables:
// - fromEmail: Verified sender address in SES
// - subjectPrefix: Prefix for forwarded email subjects
// - emailBucket: S3 bucket where SES stores emails
// - emailKeyPrefix: optional prefix for S3 keys
// - hashKey: Key used to decrypt stored forwarding addresses
// - BLOCKED_DOMAINS: Comma-separated list of blocked domains (optional)
// - BLOCKED_EMAILS: Comma-separated list of blocked emails (optional)

const defaultConfig = {
  fromEmail: process.env.fromEmail,
  subjectPrefix: "Fwd. via mailmask.me: ",
  emailBucket: process.env.emailBucket,
  emailKeyPrefix: process.env.emailKeyPrefix || "",
  hashKey: process.env.hashKey,
};

// Parse blocked domains from environment variable
function getBlockedDomains() {
  const blockedDomainsEnv = process.env.BLOCKED_DOMAINS || "";
  return blockedDomainsEnv.split(",").map(domain => domain.trim().toLowerCase()).filter(d => d);
}

// Parse the blocked inbound sender domains
function getBlockedSenderDomains() {
  return (process.env.BLOCKED_SENDER_DOMAINS || "")
    .split(",")
    .map(d => d.trim().toLowerCase())
    .filter(Boolean);
}

// Validate email format
function isValidEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

// Extract the domain from an email address
function extractDomain(email) {
  return email.split('@')[1].toLowerCase();
}

// Check if email's domain is blocked
function isBlockedDomain(email, blockedDomains) {
  const domain = extractDomain(email);
  return blockedDomains.includes(domain);
}

// Check if email is on blocklist
function getBlockedEmails() {
  return (process.env.BLOCKED_EMAILS || "")
    .split(",")
    .map(e => e.trim().toLowerCase())
    .filter(Boolean);
}

// Check if a specific email address is blocked
function isBlockedEmail(email, blockedEmails) {
  return blockedEmails.includes(email.toLowerCase());
}

// Check if the domain has valid MX records
async function hasValidMxRecords(domain) {
  try {
    const mxRecords = await dns.resolveMx(domain);
    return mxRecords.length > 0; // Valid if at least one MX record is found
  } catch (err) {
    console.error(`Error fetching MX records for ${domain}:`, err.message);
    return false;
  }
}

function verifyConfig(config) {
  const requiredVars = ["fromEmail", "emailBucket", "hashKey"];
  const missing = requiredVars.filter((v) => !config[v]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }
}

function insertSupportAndCancel(body, header, data, cancelLink) {
  // Combined support + cancel at the end
  const combinedText = `\n\nThank you for using MailMask.me!\n\n` +
    `MailMask.me is a free service designed to protect your email privacy. ` +
    `We rely on your support to keep the service running and growing. If MailMask has been useful, ` +
    `please consider supporting us at: https://www.mailmask.me/#support\n\n` +
    `Thank you for helping keep email privacy accessible!\n\n` +
    `Don't want to use MailMask anymore?\n${cancelLink}\n`;

  const combinedHTML = `
<p style="font-family: 'Avenir Next', sans-serif; margin: 20px; font-size: 1rem;">
  Thank you for using <strong>MailMask.me</strong>!<br> MailMask.me is a free service protecting your email privacy.
  We rely on your support to keep it running and growing. <br><br>If MailMask helped you, please consider supporting us at 
  <a href="https://www.mailmask.me/#support" style="color: #0095FF; font-weight: bold;">https://www.mailmask.me/#support</a>.
</p>
<img style='border-radius: 15px; margin-top: 10px; max-width: 300px; align-items: center; display: block; margin-left: auto; margin-right: auto;' src='https://mailmask-images.s3-eu-west-1.amazonaws.com/mailheader.svg'>
<p style="text-align: center; font-family: 'Avenir Next', sans-serif; margin: 50px; font-size: 1rem;">
  Don't want to use MailMask anymore? <br>
  <a href="${cancelLink}" style="color: #0095FF; font-weight: bold;">Cancel this MailMask</a>
</p>
`;

  let isHTML = /<html>/i.test(body) || /<body[^>]*>/i.test(body);

  if (isHTML) {
    console.log("Treating email as HTML.");
    if (/<body[^>]*>/i.test(body)) {
      // Insert combinedHTML before </body>
      body = body.replace(/<\/body>/i, combinedHTML + "\n</body>");
    } else {
      // No <body>, just append at end of HTML content
      body = body + "\n" + combinedHTML;
    }
  } else {
    console.log("Treating email as plain-text.");
    // Just append the combined text at the end
    if (!body.includes(combinedText.trim())) {
      body = body + combinedText;
    }
  }

  return body;
}

// Parse the SES event
exports.parseEvent = async function (data) {
  if (
    !data.event ||
    !data.event.Records ||
    data.event.Records.length !== 1 ||
    data.event.Records[0].eventSource !== "aws:ses" ||
    data.event.Records[0].eventVersion !== "1.0"
  ) {
    console.error("Invalid SES message:", JSON.stringify(data.event));
    throw new Error("Error: Received invalid SES message.");
  }

  data.email = data.event.Records[0].ses.mail;
  data.recipients = data.event.Records[0].ses.receipt.recipients;

  const isEmptyEnvelope = !data.email.source || data.email.source === "";
  const fromHeaders    = data.email.commonHeaders.from || [];
  const isMailerDaemon = fromHeaders.some(addr => /mailer-daemon@/i.test(addr));

  if (isEmptyEnvelope || isMailerDaemon) {
    console.log("Skipping SES DSN/bounce notification");
    // Force zero-recipients so later steps do nothing
    data.recipients = [];
    return data;
  }

  return data;
};

// Bounce emails when sender domain is blocked
exports.bounceIfSenderBlocked = async function(data) {
  const senderDomain = extractDomain(data.email.source);
  const blocked = getBlockedSenderDomains();
  if (blocked.includes(senderDomain)) {
    await data.ses.sendBounce({
      BounceSender: data.config.fromEmail,
      OriginalMessageId: data.email.messageId,
      BouncedRecipientInfoList: data.recipients.map(addr => ({
        Recipient: addr,
        BounceType: "ContentRejected",
        RecipientDsnFields: {
          Action: "failed",
          Status: "5.7.1",
          DiagnosticCode: "smtp; 550 Sender domain is blocked"
        }
      })),
      Explanation: `Mail from ${senderDomain} is not accepted.`
    }).promise();

    throw new Error("BounceSentinel: Bounced blocked sender domain");
  }
  return data;
};

// Get forwarding addresses from DynamoDB
exports.getFwdAddress = async function (data) {
  data.originalRecipients = data.recipients;
  data.forwardMap = []
  console.log("Original Recipients:", data.originalRecipients);

  let newRecipients = [];

  for (let origEmailKey of data.originalRecipients) {
    const regexForID = /.*(?=@mailmask\.me)/;
    const recipientID = origEmailKey.match(regexForID).toString().toLowerCase();

    console.log("Looking up recipientID:", recipientID);

    const mailParams = {
      TableName: "mailMaskList",
      Key: { mailID: recipientID },
    };

    try {
      const response = await docClient.get(mailParams).promise();
      if (response.Item && response.Item.forwardingAddress) {
        const unhashedForwardingAddress = CryptoJS.AES.decrypt(
          response.Item.forwardingAddress,
          data.config.hashKey
        ).toString(CryptoJS.enc.Utf8);
        data.forwardMap.push({origEmailKey, unhashedForwardingAddress});

      } else {
        console.warn("No forwarding address found for:", recipientID);
      }
    } catch (err) {
      console.error("Error retrieving forwarding address:", err);
    }
  }

  data.recipients = data.forwardMap.map(m => m.origEmailKey);
  return data;
};

// Bounce if no forwarding entry was found
exports.bounceIfNoMapping = async function(data) {
  if (data.originalRecipients.length > 0 && data.forwardMap.length === 0) {
    await data.ses.sendBounce({
      BounceSender: data.config.fromEmail,
      OriginalMessageId: data.email.messageId,
      BouncedRecipientInfoList: data.originalRecipients.map(r => ({
        Recipient: r,
        BounceType: "DoesNotExist",
        RecipientDsnFields: {
          Action:         "failed",
          Status:         "5.1.1",
          DiagnosticCode: "smtp; 550 Address not found"
        }
      })),
      Explanation: "That address does not exist in our system."
    }).promise();
    

    throw new Error("BounceSentinel: Bounced missing mapping");
  }
  return data;
};

// Bounce if the unhashed address or it's domain is on the blocklist
exports.bounceIfForwardBlocked = async function(data) {
  const blockedEmails  = getBlockedEmails();
  const blockedDomains = getBlockedDomains();

  for (let { origEmailKey, unhashedForwardingAddress } of data.forwardMap) {
    const domain = extractDomain(unhashedForwardingAddress);
    if (blockedEmails.includes(unhashedForwardingAddress.toLowerCase()) || blockedDomains.includes(domain)) {
      await data.ses.sendBounce({
        BounceSender: data.config.fromEmail,
        OriginalMessageId: data.email.messageId,
        BouncedRecipientInfoList: [{
          Recipient: origEmailKey,
          BounceType: "ContentRejected",
          RecipientDsnFields: {
            Action:         "failed",
            Status:         "5.7.1",
            DiagnosticCode: "smtp; 550 Forwarding address blocked"
          }
        }],
        Explanation: "That destination address is blocked by policy."
      }).promise();
      

      throw new Error("BounceSentinel: Bounced blocked recipient");
    }
  }
  return data;
};

// Fetch message from S3
exports.fetchMessage = async function (data) {
  console.log(
    `Fetching email at s3://${data.config.emailBucket}/${data.config.emailKeyPrefix}${data.email.messageId}`
  );

  const s3 = data.s3;
  try {
    await s3
      .copyObject({
        Bucket: data.config.emailBucket,
        CopySource: `${data.config.emailBucket}/${data.config.emailKeyPrefix}${data.email.messageId}`,
        Key: data.config.emailKeyPrefix + data.email.messageId,
        ACL: "private",
        ContentType: "text/plain",
        StorageClass: "STANDARD",
      })
      .promise();

    const result = await s3
      .getObject({
        Bucket: data.config.emailBucket,
        Key: data.config.emailKeyPrefix + data.email.messageId,
      })
      .promise();

    data.emailData = result.Body.toString();
    return data;
  } catch (err) {
    console.error("Error fetching message from S3:", err);
    throw new Error("Error: Failed to load message body from S3.");
  }
};

// Process message: add support & cancel link, modify headers
exports.processMessage = async function (data) {
  if (data.recipients.length === 0) {
    console.log("No recipients found, skipping processing.");
    return data;
  }

  const emailData = data.emailData;
  const match = emailData.match(/^((?:.+\r?\n)*)(\r?\n(?:.*\s+)*)/m);
  let header = match && match[1] ? match[1] : emailData;
  let body = match && match[2] ? match[2] : "";

  // Add Reply-To if missing
  if (!/^reply-to:/im.test(header)) {
    const fromMatch = header.match(/^from:[\t ]?(.*(?:\r?\n\s+.*)*\r?\n)/im);
    const from = fromMatch && fromMatch[1] ? fromMatch[1] : "";
    if (from) {
      header += `Reply-To: ${from}`;
      console.log("Added Reply-To address:", from);
    }
  }

  // Extract mailmask ID for cancel link
  const mailmaskAddresses = data.originalRecipients.filter((addr) =>
    addr.includes("mailmask.me")
  );
  const mailmaskID = mailmaskAddresses[0].slice(0, 8).toLowerCase();
  const cancelLink = `https://www.mailmask.me/?cancelMail=${mailmaskID}%40mailmask.me#cancel`;

  // Update From header to use verified fromEmail
  header = header.replace(
    /^from:\s?(.*)$/im,
    `From: ${RegExp.$1.replace(/<(.*)>/, "").trim()} <${data.config.fromEmail}>`
  );

  // Add subject prefix if configured
  if (data.config.subjectPrefix) {
    header = header.replace(
      /^subject:\s?(.*)/gim,
      `Subject: ${data.config.subjectPrefix}$1`
    );
  }

  // Replace original 'To' header if configured
  if (data.config.toEmail) {
    header = header.replace(/^to:[\t ]?(.*)/gim, `To: ${data.config.toEmail}`);
  }

  // Remove unwanted headers
  header = header.replace(/^return-path:.*\r?\n/gim, "");
  header = header.replace(/^sender:.*\r?\n/gim, "");
  header = header.replace(/^message-id:.*\r?\n/gim, "");
  header = header.replace(/^dkim-signature:[\t ]?.*\r?\n(\s+.*\r?\n)*/gim, "");

  body = insertSupportAndCancel(body, header, data, cancelLink);

  data.emailData = header + body;
  console.log("Email processed.");
  return data;
};

// Send the modified email via SES, checking blocked domains first
exports.sendMessage = async function (data) {
  if (!data.recipients.length) {
    console.log("No recipients found, skipping sendMessage.");
    return data;
  }

  const blockedDomains = getBlockedDomains();
  const blockedEmails  = getBlockedEmails();

  // Check each recipient against blocked domains
  for (const recipient of data.recipients) {
    if (!isValidEmail(recipient)) {
      console.error(`Validation Error: Invalid email format`);
      // You can choose to skip or throw an error
      // For now, let's skip sending entirely
      return data;
    }

    // Exact-address block
    if (isBlockedEmail(recipient, blockedEmails)) {
      console.error(`Validation Error: Blocked email address: ${recipient}`);
      return data;
    }


    if (isBlockedDomain(recipient, blockedDomains)) {
      console.error(`Validation Error: Blocked domain`);
      // Skip sending
      return data;
    }

    // Check MX records if desired
    const domain = extractDomain(recipient);
    const validMx = await hasValidMxRecords(domain);
    if (!validMx) {
      console.error(`Validation Error: No valid MX records for domain: ${domain}`);
      return data;
    }
  }

  const params = {
    Destinations: data.recipients,
    Source: data.originalRecipient || data.config.fromEmail,
    RawMessage: { Data: data.emailData },
  };

  console.log("Processing email with sanitized recipient count:", data.recipients.length);
  
  
  try {
    const result = await data.ses.sendRawEmail(params).promise();
    console.info(`Success: Email successfully forwarded`);
    console.log("sendRawEmail() successful:", result);
    return data;
  } catch (err) {
    console.error("sendRawEmail() returned error:", err);
    throw new Error("Error: Email sending failed.");
  }
};

// Delete the original mail from S3
exports.deleteMail = async function (data) {
  console.log(
    `Deleting email at s3://${data.config.emailBucket}/${data.config.emailKeyPrefix}${data.email.messageId}`
  );

  try {
    await data.s3
      .deleteObject({
        Bucket: data.config.emailBucket,
        Key: data.config.emailKeyPrefix + data.email.messageId,
      })
      .promise();

    console.log("Deletion was successful, deleted file");
    return data;
  } catch (err) {
    console.error("deleteObject() returned error:", err);
    throw new Error("Error: Email deletion failed.");
  }
};

// Main handler
exports.handler = async function (event, context, callback, overrides) {
  console.log("Event received:", JSON.stringify(event, null, 2));

  const config = overrides && overrides.config ? overrides.config : defaultConfig;
  verifyConfig(config);

  const data = {
    event,
    callback,
    context,
    config,
    log: overrides && overrides.log ? overrides.log : console.log,
    ses: overrides && overrides.ses ? overrides.ses : new AWS.SES(),
    s3: overrides && overrides.s3 ? overrides.s3 : new AWS.S3({ signatureVersion: "v4" }),
  };

  const steps = overrides && overrides.steps
    ? overrides.steps
    : [
        exports.parseEvent,
        exports.bounceIfSenderBlocked,  
        exports.getFwdAddress,          
        exports.bounceIfNoMapping,
        exports.bounceIfForwardBlocked,
        exports.fetchMessage,
        exports.processMessage,
        exports.sendMessage,
        exports.deleteMail,
      ];

  try {
    for (const step of steps) {
      await step(data);
    }
    console.log("Process finished successfully.");
    return callback(null, { message: "Success" });
  } catch (err) {
    console.error("Error occurred:", err);
    if (err.message.startsWith("BounceSentinel:")) {
      return callback(null, { message: err.message });
    }
    return callback(err);
  }
};
