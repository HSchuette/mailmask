let mailmaskID = "guiawhia"

let cancelLink = "www.mailmask.me/?cancelMail=" + mailmaskID + "%40mailmask.me#cancel"
  
let cancelText = "Don't want to use MailMask anymore? " + cancelLink + "\n"

let cancelHTML = "<p style='text-align: center;'><a href=" + cancelLink + " style='color: #000000;'><strong>test</strong></a></p>"

var body = 'Content-Type: multipart/alternative; boundary="wLUf7VheakOD=_?:"\n Reply-To: The North Face <thenorthface@newsletter.thenorthface.com> --wLUf7VheakOD=_?:\nContent-Type: text/plain;\ncharset="utf-8\n--wLUf7VheakOD=_?:" --wLUf7VheakOD=_?:\nContent-Type: text/html;\n<html>\n<body>\n<a style="test">Test</a>\n</body>\n<html/>\n--wLUf7VheakOD=_?:--' 

// This function cleans up the string to make this pattern searchable in regex
RegExp.cleanUp = function(str) {
    return str.toString().replace(/([.?*+^$[\]\\(){}|-])/g, "\\$1");
};

// If the email is a multipart MIME mail, search for the boundary
if (body.match(/(Content-Type: multipart\/alternative;)/mi)) {
    console.log("Found a multipart MIME mail")
    boundary = body.match(/(?<=boundary=").*(?="\n)/)
    console.log("Boundary found: " + boundary)

    var regBoundary = RegExp.cleanUp(boundary)

    console.log(regBoundary)

    plainRegex = RegExp("(?<=" + regBoundary + "\nContent-Type: text\/plain;\n[\\s\\S]*?)(?=--" + regBoundary + ")")

    console.log("Regex to search for: " + plainRegex)

    var newText = body.replace(plainRegex, cancelText)
    console.log(newText)

    htmlRegex = RegExp("(?<=" + regBoundary + "\nContent-Type: text\/html;\n[\\s\\S]*?)(?=</body>)")
    console.log("\nRegex to search for: " + htmlRegex)

    newText = body.replace(htmlRegex, cancelHTML)
    console.log(newText)
}

