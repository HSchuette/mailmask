// DELETEMAIL
// Lambda function that deletes the emails upon request

console.log("starting the lambda function");

const AWS = require('aws-sdk');
const docClient = new AWS.DynamoDB.DocumentClient({region: "eu-west-1"});


exports.handler = function(event, context, callback) {

    callback(null, {
        "statusCode": 200,
        "headers": { 
            "Access-Control-Allow-Origin": "*" 
        }
    });

    console.log(event);

    let mailmaskRegex = /.*(?=@mailmask\.me)/
    var id = event.mailID.match(mailmaskRegex).toString().toLowerCase()

    var params = {

        TableName: "mailMaskList",
        Key: {
            "mailID": id
        }
    }

    docClient.delete(params, function(err, data){
        if(err) {
            console.log(err);
            callback(err, null);
        } else {
            console.log("Deleting the item was a success!");
            callback(null, data);
        }
    });
}
