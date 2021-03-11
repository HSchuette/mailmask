"use strict";

const AWS = require('aws-sdk');
const docClient = new AWS.DynamoDB.DocumentClient({region: "eu-west-1"});

console.log("AWS Lambda SES Forwarder");

// Configure the S3 bucket and key prefix for stored raw emails, and the
// mapping of email addresses to forward from and to.
//
// Expected keys/values:
//
// - fromEmail: Forwarded emails will come from this verified address
//
// - subjectPrefix: Forwarded emails subject will contain this prefix
//
// - emailBucket: S3 bucket name where SES stores emails.
//
// - emailKeyPrefix: S3 key name prefix where SES stores email. Include the
//   trailing slash.

var defaultConfig = {
  fromEmail: "main@mailmask.me",
  subjectPrefix: "Fwd. via MailMask.me: ",
  emailBucket: "bucket4mailmask",
  emailKeyPrefix: "",
};

/**
 * Parses the SES event record provided for the `mail` and `receipients` data.
 *
 * @param {object} data - Data bundle with context, email, etc.
 *
 * @return {object} - Promise resolved with data.
 */
exports.parseEvent = function(data) {
  // Validate characteristics of a SES event record.
  if (!data.event ||
      !data.event.hasOwnProperty('Records') ||
      data.event.Records.length !== 1 ||
      !data.event.Records[0].hasOwnProperty('eventSource') ||
      data.event.Records[0].eventSource !== 'aws:ses' ||
      data.event.Records[0].eventVersion !== '1.0') {
    data.log({
      message: "parseEvent() received invalid SES message:",
      level: "error", event: JSON.stringify(data.event)
    });
    return Promise.reject(new Error('Error: Received invalid SES message.'));
  }

  data.email = data.event.Records[0].ses.mail;
  data.recipients = data.event.Records[0].ses.receipt.recipients;
  return Promise.resolve(data);
};

/**
 * Getting the forwarding addresses of the incommig mails
 *
 * @param {object} data - Data bundle with context, email, etc.
 *
 * @return {object} - Promise resolved with data.
 */
exports.getFwdAddress = async function(data) {
  data.originalRecipients = data.recipients;

  data.log(data.originalRecipients)

  var newRecipients = [];

  for (var i = 0, len = data.originalRecipients.length; i < len; i++) {
    var origEmailKey = data.originalRecipients[i]
    var recipientiD = origEmailKey.toString().slice(0,8).toLowerCase()

    console.log("recipientID is " + recipientiD)
    
    var mailParams = {
      TableName: "mailMaskList",
      Key: {
          "mailID": recipientiD
      }
    };

    await docClient.get(mailParams, function(err,response){
      if (err) {
        console.error("Unable to get item. Error JSON:", JSON.stringify(err, null, 2));
      } else {
        try {
          newRecipients = newRecipients.concat(response.Item.forwardingAddress)
          console.log("Forwarding Address added: ", newRecipients)
        } catch {
          console.error("Unable to find recipientID item. Error JSON:", JSON.stringify(err, null, 2));   

        }        
      }
    })
    .promise()
  };

  data.recipients = newRecipients;

  return Promise.resolve(data)
};

/**
 * Fetches the message data from S3.
 *
 * @param {object} data - Data bundle with context, email, etc.
 *
 * @return {object} - Promise resolved with data.
 */
exports.fetchMessage = function(data) {
  // Copying email object to ensure read permission
  data.log({
    level: "info",
    message: "Fetching email at s3://" + data.config.emailBucket + '/' +
      data.config.emailKeyPrefix + data.email.messageId
  });
  return new Promise(function(resolve, reject) {
    data.s3.copyObject({
      Bucket: data.config.emailBucket,
      CopySource: data.config.emailBucket + '/' + data.config.emailKeyPrefix +
        data.email.messageId,
      Key: data.config.emailKeyPrefix + data.email.messageId,
      ACL: 'private',
      ContentType: 'text/plain',
      StorageClass: 'STANDARD'
    }, function(err) {
      if (err) {
        data.log({
          level: "error",
          message: "copyObject() returned error:",
          error: err,
          stack: err.stack
        });
        return reject(
          new Error("Error: Could not make readable copy of email."));
      }

      // Load the raw email from S3
      data.s3.getObject({
        Bucket: data.config.emailBucket,
        Key: data.config.emailKeyPrefix + data.email.messageId
      }, function(err, result) {
        if (err) {
          data.log({
            level: "error",
            message: "getObject() returned error:",
            error: err,
            stack: err.stack
          });
          return reject(
            new Error("Error: Failed to load message body from S3."));
        }
        data.emailData = result.Body.toString();
        return resolve(data);
      });
    });
  });
};

/**
 * Processes the message data, making updates to recipients and other headers
 * before forwarding message.
 *
 * @param {object} data - Data bundle with context, email, etc.
 *
 * @return {object} - Promise resolved with data.
 */
exports.processMessage = function(data) {
  var match = data.emailData.match(/^((?:.+\r?\n)*)(\r?\n(?:.*\s+)*)/m);
  var header = match && match[1] ? match[1] : data.emailData;
  var body = match && match[2] ? match[2] : '';

  // Add "Reply-To:" with the "From" address if it doesn't already exists
  if (!/^reply-to:[\t ]?/mi.test(header)) {
    match = header.match(/^from:[\t ]?(.*(?:\r?\n\s+.*)*\r?\n)/mi);
    var from = match && match[1] ? match[1] : '';
    if (from) {
      header = header + 'Reply-To: ' + from;
      data.log({
        level: "info",
        message: "Added Reply-To address of: " + from
      });
    } else {
      data.log({
        level: "info",
        message: "Reply-To address not added because From address was not " +
          "properly extracted."
      });
    }
  }

  // Get the recipientID and build a link that lets the user easily delete his/her address
  // First step is to find the mailmask.me address inside the recipients
  // Currently, it is not supported to cover more than one mailmask address
  let mailmaskAddresses = data.originalRecipients.filter(address => address.includes("mailmask.me"))
  
  let mailmaskID = mailmaskAddresses[0].toString().slice(0,8).toLowerCase()
  
  let cancelLink = "www.mailmask.me/?cancelMail=" + mailmaskID + "%40mailmask.me#cancel"
  
  let cancelText = "Don't want to use MailMask anymore? " + cancelLink

  body = body + cancelText

  // SES does not allow sending messages from an unverified address,
  // so replace the message's "From:" header with the original
  // recipient (which is a verified domain)
  header = header.replace(
    /^from:[\t ]?(.*(?:\r?\n\s+.*)*)/mgi,
    function(match, from) {
      var fromText;
      if (data.config.fromEmail) {
        fromText = 'From: ' + from.replace(/<(.*)>/, '').trim() +
        ' <' + data.config.fromEmail + '>';
      } else {
        fromText = 'From: ' + from.replace('<', 'at ').replace('>', '') +
        ' <' + data.originalRecipient + '>';
      }
      return fromText;
    });

  // Add a prefix to the Subject
  if (data.config.subjectPrefix) {
    header = header.replace(
      /^subject:[\t ]?(.*)/mgi,
      function(match, subject) {
        return 'Subject: ' + data.config.subjectPrefix + subject;
      });
  }

  // Replace original 'To' header with a manually defined one
  if (data.config.toEmail) {
    header = header.replace(/^to:[\t ]?(.*)/mgi, () => 'To: ' + data.config.toEmail);
  }

  // Remove the Return-Path header.
  header = header.replace(/^return-path:[\t ]?(.*)\r?\n/mgi, '');

  // Remove Sender header.
  header = header.replace(/^sender:[\t ]?(.*)\r?\n/mgi, '');

  // Remove Message-ID header.
  header = header.replace(/^message-id:[\t ]?(.*)\r?\n/mgi, '');

  // Remove all DKIM-Signature headers to prevent triggering an
  // "InvalidParameterValue: Duplicate header 'DKIM-Signature'" error.
  // These signatures will likely be invalid anyways, since the From
  // header was modified.
  header = header.replace(/^dkim-signature:[\t ]?.*\r?\n(\s+.*\r?\n)*/mgi, '');

  data.emailData = header + body;

  console.log(data.emailData)
  return Promise.resolve(data);
};

/**
 * Deletes the message data from S3.
 *
 * @param {object} data - Data bundle with context, email, etc.
 *
 */
exports.deleteMail = function(data) {
    // Deleting the mail after it was send
  data.log({
    level: "info",
    message: "Fetching email for deletion at s3://" + data.config.emailBucket + '/' +
      data.config.emailKeyPrefix + data.email.messageId
  });

  // Delete the raw email from S3
  return new Promise(function(resolve, reject) {
    data.s3.deleteObject({
        Bucket: data.config.emailBucket,
        Key: data.config.emailKeyPrefix + data.email.messageId
    }, function(err, data) {
        if (err) {
          data.log({
            level: "error",
            message: "deleteObject() returned error:",
            error: err,
            stack: err.stack
          });
          return reject(new Error('Error: Email deletion failed.'));
        }
        console.log({
          level: "info",
          message: "Deletion was successful, deleted file"
        });
        return resolve(data);        
    });
  });
};

/**
 * Send email using the SES sendRawEmail command.
 *
 * @param {object} data - Data bundle with context, email, etc.
 *
 * @return {object} - Promise resolved with data.
 */
exports.sendMessage = function(data) {
  if (data.recipients.length) {
    var params = {
      Destinations: data.recipients,
      Source: data.originalRecipient,
      RawMessage: {
        Data: data.emailData
      }
    };

  data.log({
    level: "info",
    message: "sendMessage: Sending email via SES. Original recipients: " +
      data.originalRecipients.join(", ") + ". Transformed recipients: " +
      data.recipients + "."
  });
  return new Promise(function(resolve, reject) {
    data.ses.sendRawEmail(params, function(err, result) {
      if (err) {
        data.log({
          level: "error",
          message: "sendRawEmail() returned error.",
          error: err,
          stack: err.stack
        });
        return reject(new Error('Error: Email sending failed.'));
      }
      data.log({
        level: "info",
        message: "sendRawEmail() successful.",
        result: result
      });
      resolve(data);
    });
  });
  }
};

/**
 * Handler function to be invoked by AWS Lambda with an inbound SES email as
 * the event.
 *
 * @param {object} event - Lambda event from inbound email received by AWS SES.
 * @param {object} context - Lambda context object.
 * @param {object} callback - Lambda callback object.
 * @param {object} overrides - Overrides for the default data, including the
 * configuration, SES object, and S3 object.
 */
exports.handler = function(event, context, callback, overrides) {
  console.log(event)

  var steps = overrides && overrides.steps ? overrides.steps :
    [
      exports.parseEvent,
      exports.getFwdAddress,
      exports.fetchMessage,
      exports.processMessage,
      exports.sendMessage,  
      exports.deleteMail
    ];
  var data = {
    event: event,
    callback: callback,
    context: context,
    config: overrides && overrides.config ? overrides.config : defaultConfig,
    log: overrides && overrides.log ? overrides.log : console.log,
    ses: overrides && overrides.ses ? overrides.ses : new AWS.SES(),
    s3: overrides && overrides.s3 ?
      overrides.s3 : new AWS.S3({signatureVersion: 'v4'})
  };
  
  steps.reduce((cur, next) => cur.then(next), Promise.resolve(data)).then(() => {
    console.log({
      level: "info",
      message: "Process finished successfully."
    });
  });

  // Promise.series(steps, data)
  //   .then(function(data) {
  //     console.log({
  //       level: "info",
  //       message: "Process finished successfully."
  //     });
  //   })
  //   .catch(function(err) {
  //     console.log({
  //       level: "error",
  //       message: "Step returned error: " + err.message,
  //       error: err,
  //       stack: err.stack
  //     });
  //     return data.callback(new Error("Error: Step returned error."));
  //   });
};

// Promise.series = function(promises, initValue) {
//   return promises.reduce(function(chain, promise) {
//     if (typeof promise !== 'function') {
//       return Promise.reject(new Error("Error: Invalid promise item: " +
//         promise));
//     }
//     return chain.then(promise);
//   }, Promise.resolve(initValue));
// };

