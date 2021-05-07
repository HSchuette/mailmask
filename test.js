const CryptoJS = require("crypto-js");

//let key = process.env.hashKey
let key = "***REMOVED***"

// TODO save the key as enviroment variable

var string = "hendrik.schuette@mailmask.me"

var hashedString = CryptoJS.AES.encrypt(string, key).toString()

var dehashedString = CryptoJS.AES.decrypt(hashedString, key).toString(CryptoJS.enc.Utf8)

console.log(hashedString)

console.log(dehashedString)
