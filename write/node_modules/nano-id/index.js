var alphanumeric = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

var nanoId = function (length) {
  if (length == null) {
    length = 10;
  }
  var result = '';
  for (var i = 0; i < length; ++i) {
    result += alphanumeric[Math.floor(Math.random() * alphanumeric.length)];
  }
  return result;
};

nanoId.verify = function (nanoId) {
  return typeof nanoId === 'string' && /^[a-zA-Z0-9]+$/.test(nanoId);
};

module.exports = nanoId;
