// POSTMAIL
// Lambda function that creates a new mailmask forwarding mail

console.log("starting the lambda function");

const AWS = require('aws-sdk');
const docClient = new AWS.DynamoDB.DocumentClient({region: "eu-west-1"});
const nanoid = require('nano-id');
const CryptoJS = require("crypto-js");

//   routingAddress is the randomly generated address from mailmask
//   clientAddress is the address that should recieve the mail
//   isBoundToNewsletter is a boolean that decides whether the forwarding address should be limited
//   to one domain only

exports.handler = function(event, context, callback) {
    
    callback(null, {
        "statusCode": 200,
        "headers": { 
            "Access-Control-Allow-Origin": "*" 
        }
    });

    let mailmaskRegex = /.*@mailmask\.me/
    console.log(mailmaskRegex.test(event.forwardingAddress))

    if (mailmaskRegex.test(event.forwardingAddress)) {
        console.log("Did not write because of looping mail.")
    } else {
        let key = process.env.hashKey

        var id = nanoid(8).toLowerCase()
        var hashedForwardingAddress = CryptoJS.AES.encrypt(event.forwardingAddress, key).toString()

        console.log(hashedForwardingAddress)
        console.log(id)

        var params = {
            Item: {
                mailID: id,
                routingAddress: id + "@mailmask.me",
                forwardingAddress: hashedForwardingAddress,
                isBoundToNewsletter: false,
                boundedMail: null
            },

            TableName: "mailMaskList"
        };        
    
        docClient.put(params, function(err, data) {
            if(err) {
                console.log(err);
                callback(err, null);
            } else {
                console.log("Writing was a success!");
                callback(null, data);
            }
        });
    }
}