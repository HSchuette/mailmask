const AWS = require('aws-sdk');
const ses = new AWS.SES();
 
exports.handler = async (event) => {
 
    let newDBEntry = event.Records[0].dynamodb;
    console.log(newDBEntry);
 
    let forwardingAddress = newDBEntry.NewImage.forwardingAddress.S;
    let routingAddress = newDBEntry.NewImage.routingAddress.S;
    let messagebody = 'Hi! Your new mailmask address is: ' + routingAddress
 
    try {
        let data = await ses.sendEmail({
            Source: "mail@mailmask.me",
            Destination: {
                ToAddresses: [forwardingAddress]
            },
            Message: {
                Subject: {
                    Data: "Your MailMask email is here!"
                },
                Body: {
                    Text: {
                        Data: messagebody
                    }
                }
            }
        }).promise();
 
    } catch (err) {
        console.log("Email sending failed", err)
    };
 
 
    return { "message": "Successfully executed" };
};