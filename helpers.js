let mailmaskID = "guiawhia"

let cancelLink = "www.mailmask.me/?cancelMail=" + mailmaskID + "%40mailmask.me#cancel"
  
let cancelText = "\nDon't want to use MailMask anymore? " + cancelLink + "\n"

let cancelHTML = "<p style='text-align: center;'><a href=" + cancelLink + " style='color: #000000;'><strong>test</strong></a></p>"

var body = 'Content-Type: multipart/alternative;\nboundary="==58cb55cf85023a8c23dd3eb2002acbd8"\n\nThis is a multi-part message in MIME format.\n\n--==58cb55cf85023a8c23dd3eb2002acbd8\nContent-Type: text/plain; charset=UTF-8\nContent-Transfer-Encoding: quoted-printable"' 

console.log(cancelText)


// This function cleans up the string to make this pattern searchable in regex
RegExp.cleanUp = function(str) {
    return str.toString().replace(/([.?*+^$[\]\\(){}|-])/g, "\\$1");
};

// If the email is a multipart MIME mail, search for the boundary
if (body.match(/(Content-Type: multipart\/alternative;)/g)) {
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

console.log(body)
