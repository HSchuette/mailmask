// GETMAIL

console.log("starting the lambda function");

const AWS = require('aws-sdk');
const docClient = new AWS.DynamoDB.DocumentClient({region: "eu-west-1"});


exports.handler = function(event, context, callback) {

    var params = {

        TableName: "mailMaskList",
        Key: {
            "mailID": "02f9e0d2-8f20-4519-8307-a84e3a32a15f"
        }
    }

    docClient.get(params, function(err, data){
        if(err) {
            console.log(err);
            callback(err, null);
        } else {
            console.log("Getting the item was a success!");
            callback(null, data);
        }
    });
}
