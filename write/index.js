// POSTMAIL
// Lambda function that creates a new mailmask forwarding mail

console.log("starting the lambda function");

const AWS = require('aws-sdk');
const dns = require('dns').promises;
const docClient = new AWS.DynamoDB.DocumentClient({ region: "eu-west-1" });
const nanoid = require('nano-id');
const CryptoJS = require("crypto-js");

//   routingAddress is the randomly generated address from mailmask
//   clientAddress is the address that should recieve the mail
//   isBoundToNewsletter is a boolean that decides whether the forwarding address should be limited
//   to one domain only

// Parse blocked domains from environment variable
function getBlockedDomains() {
    const blockedDomainsEnv = process.env.BLOCKED_DOMAINS || "";
    return blockedDomainsEnv.split(",").map(domain => domain.trim().toLowerCase());
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

exports.handler = async function (event, context, callback) {
    console.log("Incoming request:", event);

    const responseHeaders = {
        "Access-Control-Allow-Origin": "*",
    };

    try {
        const { forwardingAddress, label } = event;

        // Validate forwarding address
        if (!isValidEmail(forwardingAddress)) {
            console.log("Validation Error: Invalid email format");
            return callback(null, {
                statusCode: 400,
                headers: responseHeaders,
                body: JSON.stringify({ error: "Invalid email format." }),
            });
        }

        // Check blocked domains
        const blockedDomains = getBlockedDomains();
        if (isBlockedDomain(forwardingAddress, blockedDomains)) {
            console.log("Validation Error: Blocked domain");
            return callback(null, {
                statusCode: 403,
                headers: responseHeaders,
                body: JSON.stringify({ error: "Temporary email domains are not allowed." }),
            });
        }

        // Check if the domain has valid MX records
        const domain = extractDomain(forwardingAddress);
        const validMx = await hasValidMxRecords(domain);
        if (!validMx) {
            console.log("Validation Error: Invalid MX records");
            return callback(null, {
                statusCode: 403,
                headers: responseHeaders,
                body: JSON.stringify({ error: "Invalid email domain. No valid MX records found." }),
            });
        }

        // Generate unique ID
        let id = nanoid(8).toLowerCase();

        // Clean label
        let cleanedLabel = "";
        if (label) {
            cleanedLabel = label.replace(/[^A-Za-z0-9äÄüÜöÖ]/gm, "");
            id = `${id}+${cleanedLabel.toLowerCase()}`;
        }

        // Encrypt forwarding address
        const key = process.env.hashKey;
        if (!key) {
            throw new Error("Encryption key not set in environment variables.");
        }
        const hashedForwardingAddress = CryptoJS.AES.encrypt(forwardingAddress, key).toString();

        // Prepare DynamoDB entry
        const params = {
            TableName: "mailMaskList",
            Item: {
                mailID: id,
                routingAddress: `${id}@mailmask.me`,
                forwardingAddress: hashedForwardingAddress,
                label: label || null,
                isBoundToNewsletter: false,
                boundedMail: null,
            },
        };

        // Write to DynamoDB
        await docClient.put(params).promise();
        console.log("Success: Forwarding address created", { id, routingAddress: `${id}@mailmask.me` });
        console.log("Record successfully written:", params.Item);

        // Respond without mailID
        callback(null, {
            statusCode: 200,
            headers: responseHeaders,
            body: JSON.stringify({ success: true, message: "Forwarding address created successfully." }),
        });
    } catch (error) {
        console.error("Error handling request:", error);

        callback(null, {
            statusCode: 500,
            headers: responseHeaders,
            body: JSON.stringify({ error: "Internal server error." }),
        });
    }
};