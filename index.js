"use strict";

const AWS = require('aws-sdk');
const docClient = new AWS.DynamoDB.DocumentClient({region: "eu-west-1"});

console.log("AWS Lambda SES Forwarder // @arithmetric // Version 5.0.0");

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
//
// - allowPlusSign: Enables support for plus sign suffixes on email addresses.
//   If set to `true`, the username/mailbox part of an email address is parsed
//   to remove anything after a plus sign. For example, an email sent to
//   `example+test@example.com` would be treated as if it was sent to
//   `example@example.com`.
//
// - forwardMapping: Object where the key is the lowercase email address from
//   which to forward and the value is an array of email addresses to which to
//   send the message.
//
//   To match all email addresses on a domain, use a key without the name part
//   of an email address before the "at" symbol (i.e. `@example.com`).
//
//   To match a mailbox name on all domains, use a key without the "at" symbol
//   and domain part of an email address (i.e. `info`).
//
//   To match all email addresses matching no other mapping, use "@" as a key.
var defaultConfig = {
  fromEmail: "main@mailmask.me",
  subjectPrefix: "Fwd. via MailMask.me:",
  emailBucket: "bucket4mailmask",
  emailKeyPrefix: "",
  allowPlusSign: true,
  forwardMapping: {
    "test@mailmask.me": [
      "hendrik.schuette@t-online.de"
    ],
    "2c461869-f9b8-44e1-8b1a-39266e71b075@mailmask.me": [
        "hendrik.schuette@tutanota.com"
      ],
    "i7z9g89g3dwhu@mailmask.me": [
        "hendrik.schuette@icloud.com"
      ],
    "6t7fugzhz78g76u@mailmask.me": [
        "alexschuette@t-online.de"
      ],
    "98uijcs98ww4hr@mailmask.me": [
        "fabian.emil@t-online.de"
    ]
  }
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
 * Transforms the original recipients to the desired forwarded destinations.
 *
 * @param {object} data - Data bundle with context, email, etc.
 *
 * @return {object} - Promise resolved with data.
 */
exports.transformRecipients = function(data) {
  var newRecipients = [];
  data.originalRecipients = data.recipients;
  data.recipients.forEach(function(origEmail) {
    var origEmailKey = origEmail.toLowerCase();
    if (data.config.allowPlusSign) {
      origEmailKey = origEmailKey.replace(/\+.*?@/, '@');
    }

    var recipientiD = origEmailKey.toString().slice(0,36)
    console.log(recipientiD)
  
    // try {
    //   let mailData = docClient.get(mailParams).promise();
    //   let fwdaddress = mailData.Item.forwardingAddress;
    //   console.log("SUCCESSFULL GET", fwdaddress);
    // } catch(err) {
    //   console.log(err);
    // }
    // docClient.get(mailParams, function(err, mailData){
    //   if(err) {
    //     console.log("Failed at retrieving the mapping data for the mail.")
    //     console.log(err);
    //   } else {
    //     console.log("Getting the item was a success!");
    //     console.log(mailData.Item.forwardingAddress);
    //     fwdaddress = mailData.Item.forwardingAddresss
    //   }
    // });

    async function getfwdAddress() {
      var mailParams = {
        TableName: "mailMaskList",
        Key: {
            "mailID": recipientiD
        }
      }

      try {
        let res = await docClient.get(mailParams).promise()
        console.log(res)
      } catch (error) {
        console.error(error)
      }
    
    }
    
    var fwdItem = getfwdAddress()
    console.log(fwdItem)

    var fwdaddress = fwdItem.forwardingAddress
    console.log(fwdaddress)

    newRecipients = newRecipients.concat(fwdaddress)
    // if (data.config.forwardMapping.hasOwnProperty(origEmailKey)) {
    //   newRecipients = newRecipients.concat(
    //     data.config.forwardMapping[origEmailKey]);
    //   data.originalRecipient = origEmail;
    // } else {
    //   var origEmailDomain;
    //   var origEmailUser;
    //   var pos = origEmailKey.lastIndexOf("@");
    //   if (pos === -1) {
    //     origEmailUser = origEmailKey;
    //   } else {
    //     origEmailDomain = origEmailKey.slice(pos);
    //     origEmailUser = origEmailKey.slice(0, pos);
    //   }
    //   if (origEmailDomain &&
    //       data.config.forwardMapping.hasOwnProperty(origEmailDomain)) {
    //     newRecipients = newRecipients.concat(
    //       data.config.forwardMapping[origEmailDomain]);
    //     data.originalRecipient = origEmail;
    //   } else if (origEmailUser &&
    //     data.config.forwardMapping.hasOwnProperty(origEmailUser)) {
    //     newRecipients = newRecipients.concat(
    //       data.config.forwardMapping[origEmailUser]);
    //     data.originalRecipient = origEmail;
    //   } else if (data.config.forwardMapping.hasOwnProperty("@")) {
    //     newRecipients = newRecipients.concat(
    //       data.config.forwardMapping["@"]);
    //     data.originalRecipient = origEmail;
    //   }
    // }
  });

  if (!newRecipients.length) {
    data.log({
      message: "Finishing process. No new recipients found for " +
        "original destinations: " + data.originalRecipients.join(", "),
      level: "info"
    });
    return data.callback();
  };

  data.recipients = newRecipients;
  return Promise.resolve(data);
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
  var params = {
    Destinations: data.recipients,
    Source: data.originalRecipient,
    RawMessage: {
      Data: data.emailData
    }
  };

  var recipientiD = data.originalRecipients.toString().slice(0,36)
  console.log(recipientiD)

  var mailParams = {

    TableName: "mailMaskList",
    Key: {
        "mailID": recipientiD
    }
  }

  docClient.get(mailParams, function(err, mailData){
    if(err) {
      console.log("Failed at retrieving the mapping data for the mail.")
      console.log(err);
    } else {
      console.log("Getting the item was a success!");
      console.log(mailData.Item.forwardingAddress);
    }
  });

  data.log({
    level: "info",
    message: "sendMessage: Sending email via SES. Original recipients: " +
      data.originalRecipients.join(", ") + ". Transformed recipients: " +
      data.recipients.join(", ") + "."
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
};

/**
 * Gets the forwardMapping data from dynamoDB 
 * 
 * @param {object} data - Data bundle with context, email, etc.
 *
*/
// exports.getForwardingAddress = function(data) {

//   data.log({
//     level: "info",
//     message: "Getting the recipientID from the mail:" +  data.originalRecipients
//   });

//   var params = {

//       TableName: "mailMaskList",
//       // Key: {
//       //     "mailID": "02f9e0d2-8f20-4519-8307-a84e3a32a15f"
//       // }
//       Key: {
//           "mailID": data.originalRecipients.slice(0,36)
//       }

//   }

//   docClient.get(params, function(err, data){
//       if(err) {
//           console.log(err);
//       } else {
//           console.log("Getting the item was a success!");
//           console.log(data);
//       }
//   });
// };

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
  var steps = overrides && overrides.steps ? overrides.steps :
    [
      exports.parseEvent,
      // exports.getForwardingAddress,
      exports.transformRecipients,
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
  Promise.series(steps, data)
    .then(function(data) {
      console.log({
        level: "info",
        message: "Process finished successfully."
      });
    })
    .catch(function(err) {
      console.log({
        level: "error",
        message: "Step returned error: " + err.message,
        error: err,
        stack: err.stack
      });
      return data.callback(new Error("Error: Step returned error."));
    });
};

Promise.series = function(promises, initValue) {
  return promises.reduce(function(chain, promise) {
    if (typeof promise !== 'function') {
      return Promise.reject(new Error("Error: Invalid promise item: " +
        promise));
    }
    return chain.then(promise);
  }, Promise.resolve(initValue));
};