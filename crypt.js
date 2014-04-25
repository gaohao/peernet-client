const REDIS_PORT = 6379;
const REDIS_HOST = "localhost";
const ENCODING = "utf8";

var ursa = require("ursa");
var mp = require('./mp.js');
var redis_module = require("redis");
var redislib = redis_module.createClient(REDIS_PORT,REDIS_HOST);

var keysA;
var pubPemA;
var pubkey;

var prvPemA;
var privKey;

exports.createKeys = function () {
    keysA = ursa.generatePrivateKey(1024, 17);
    pubPemA = keysA.toPublicPem(ENCODING);
    pubkey = ursa.createPublicKey(pubPemA, ENCODING);

    prvPemA = keysA.toPrivatePem(ENCODING);
    privKey = ursa.createPrivateKey(prvPemA, '', ENCODING);

    redislib.set("mypubkey", pubPemA);
    redislib.set("myprivkey", keysA);
    redislib.set("myprivkey2", prvPemA);
    redislib.set("myprivkey3", privKey);
};

exports.init = function (username) {
    redislib.get("myprivkey", function (err, myprivKey) {
        if (myprivKey == null) {
            keysA = ursa.generatePrivateKey(1024, 17);
            pubPemA = keysA.toPublicPem(ENCODING);
            pubkey = ursa.createPublicKey(pubPemA, ENCODING);

            prvPemA = keysA.toPrivatePem(ENCODING);
            privKey = ursa.createPrivateKey(prvPemA, '', ENCODING);

            mp.getCentralServer().emit("publickey", username, pubPemA);

            redislib.set("mypubkey", pubPemA);
            redislib.set("myprivkey", prvPemA);
        } else {
            redislib.get("myprivkey", function (err, redisprvPemA) {
                prvPemA = redisprvPemA;
                privKey = ursa.createPrivateKey(prvPemA, '', ENCODING);	
            });
        }
    });
};

exports.encrypt = function (message, key) {
    this.init();
    var pubKeyObject = ursa.createPublicKey(key, ENCODING);
    var encrypted = pubKeyObject.encrypt(message, ENCODING);
    return encrypted;
};

exports.decrypt = function (encrypted) {
    this.init();
    var decrypted = privKey.decrypt(encrypted, ENCODING);
    console.log("Decreypted message is " + decrypted);
    return String(decrypted);
};

