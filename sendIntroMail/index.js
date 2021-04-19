const AWS = require('aws-sdk');
const ses = new AWS.SES();
 
exports.handler = async (event) => {
 
    let newDBEntry = event.Records[0].dynamodb;
    console.log(newDBEntry);
 
    let forwardingAddress = newDBEntry.NewImage.forwardingAddress.S;
    let routingAddress = newDBEntry.NewImage.routingAddress.S;
    let messagebody = 'Hi! Your new mailmask address is: ' + routingAddress

    let regexRouting = /\{\{routingAddress\}\}/g;
    let regexForwarding = /\{\{forwardingAddress\}\}/g;

    let rawMail =  `From: "MailMask.me" <mail@mailmask.me>
To: {{forwardingAddress}}
Subject: Your MailMask email has arrived!
MIME-Version: 1.0
Content-Type: multipart/alternative; 
    boundary="h8uz7htzu78o6tguz78t6ogzu78tgz"

This is a multi-part message in MIME format.

--h8uz7htzu78o6tguz78t6ogzu78tgz
Content-Type: text/plain; 
    charset="utf-8"
Content-Transfer-Encoding: quoted-printable
Content-Disposition: inline

Hello there!

Your new MailMask address has arrived. All incoming emails to this address are automatically forwarded to your personal address. 

Your new mailmask address is: {{routingAddress}}

If you like MailMask, feel free to spread the word and head to our support page. 
-> https://www.mailmask.me/#support

In case you did not trigger this mail or do not want to receive any mails from us, feel free to cancel the forwarding address.
-> https://www.mailmask.me/#cancel

Thank your for using MailMask!

---------------

www.mailmask.me
© 2020 All Rights Reserved

Hendrik Schuette, Turmstraße 54, 10551 Berlin

--h8uz7htzu78o6tguz78t6ogzu78tgz
Content-Type: text/html; 
    charset="utf-8"
Content-Transfer-Encoding: quoted-printable
Content-Disposition: inline

<!DOCTYPE html>
<html>
<head>
    <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="x-apple-disable-message-reformatting">

    <style type="text/css">

    * {box-sizing: border-box; 
        /* Color scheme */
        
    --textcolor: rgb(0, 0, 0);
    --bgcolor: #f3f3f3;
    --highlight: #0095FF;
    --bg2color: #f6f6f6;
    --warning: #aa1515;
    
    }
    
    html {
    background-color: var(--bgcolor);
    }

    main {
        position: relative;
    }

    body {
        padding: 0;
        line-height: 1.6;
        font-size: 1.1rem;
        color: var(--textcolor);        
        position: relative;
        font-family: 'Avenir Next', sans-serif; 
        margin: 2rem;  
        min-width: 100%;          
    }

    .main-image {
      border-radius: 15px;
      width: 100%;
      position: relative;
      padding: 0;
    }

    .container {
      background-color: white;      
      box-shadow: 2px 1px 45px 0px rgba(0,0,0,0.29);
      border-radius: 15px;
      padding-bottom: 1rem;
    }

    .main-text {
      margin: 2.4rem;
    }

    .main-email {
      text-align: center;
      color: var(--highlight)
    }

    footer {
      text-align: center;
      font-size: 0.8rem;
      padding-top: 30px;
    }

    a {
      color: var(--highlight)
    }

    @media only screen and (max-width: 600px) {
    body {
        margin: 0rem;          
    }

    .container {
      border-radius: 0px;
    }


    .main-text {
      margin: 1.2rem; 
    }

    .main-image {
        border-radius: 0px;
        overflow: auto;
    }      
    }

    </style>

</head>

    <body class="main-content">
    <div class="container">
        <img class="main-image" src="https://mailmask-images.s3-eu-west-1.amazonaws.com/mailmask-mailheader.svg">
        <div class="main-text">
            <p>Hello there!</p>
            <p>Your new MailMask address has arrived. All incoming emails to this address are automatically forwarded to your personal address.</p>
        </div>

        <div class="main-email">
            <a href="mailto:{{routingAddress}}"><b><u>{{routingAddress}}</u></b></a>
        </div>

        <div class="main-text">
            <p>If you like MailMask, feel free to spread the word and head to our <a href="www.mailmask.me#support">support page</a>.</p>
            <p>In case you did not trigger this mail or do not want to receive any mails from us, feel free to cancel the forwarding address <a href="www.mailmask.me#cancel">here</a>.</p>
        </div>
        </div>
    </body>

    <footer>
    <a href="www.mailmask.me" target="_blank">www.mailmask.me</a>
    <p>© 2020 All Rights Reserved</p>
    <p>Hendrik Schuette, Turmstraße 54, 10551 Berlin</p>
    </footer>

</html>

--h8uz7htzu78o6tguz78t6ogzu78tgz--

`
    let emailContent = rawMail.replace(regexRouting, routingAddress)
    emailContent = emailContent.replace(regexForwarding, forwardingAddress)

    console.log(emailContent)

    try {
        let data = await ses.sendRawEmail({ 
            Source: "mail@mailmask.me",
            Destinations: [
                forwardingAddress
            ],
            RawMessage: {
                Data: emailContent
            }           
        }).promise();
 
    } catch (err) {
        console.log("Email sending failed", err)
    };

    return { "message": "Successfully executed" };
};