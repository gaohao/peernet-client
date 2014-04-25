const CENTRAL_SERVER_IP = "peernet.heroku.com";
const CENTRAL_SERVER_PORT = 80;
const PEER_SERVER_SOCK_PORT = 8082;

var async = require('async');
var ioClient = require('socket.io-client');

var servers = { };
var clients = { };

var getCentralServer = function () {
    return getClientIO(CENTRAL_SERVER_IP, CENTRAL_SERVER_PORT);
};
exports.getCentralServer = getCentralServer;

var getUserIp = function (userName, callback) {
    var central = getCentralServer();
    central.emit('getIP', userName);
    central.on('receiveIP' + userName, function cb_wrap(ip) {
        console.log("receiveIP" + userName + " event occured");
        central.removeListener('receiveIP' + userName, cb_wrap);
        callback(ip);
    });
};

var getServerIO = function (port) {
    if (servers[port] == null) {
        var io = require('socket.io').listen(port);
        if (io == null) {
            return null;
        }
        console.log("Server started on port " + port);
        servers[port] = io;
        return io.sockets;
    }
    return servers[port];
};
exports.getServerIO = getServerIO;

var getClientIO = function (ip, port) {
    if (clients[ip + port] == null) {
        var socket = ioClient.connect(ip, {port:port,reconnect: true});
        if(socket==null) {
            return null;
        }
        console.log("connected with peer as client");
        clients[ip+port] = socket;
        return socket;
    }
    return clients[ip+port];
}
exports.getClientIO = getClientIO;

var send = function (eventName, destUsername, shouldEncryptMsg, msg) {
    console.log("eventName -"+eventName+" destUsername -"+ destUsername + " msg -"+msg);
    if (shouldEncryptMsg) 
    {
        console.log("in encrypt block "+ shouldEncryptMsg);

        //  console.log("in get userip callback");
        async.series([
                function (callback) {
                    var central = getCentralServer();
                    central.on('receiveIP' + destUsername,function cb_wrap(ip) {
                        console.log("receiveIP"+destUsername+" event occured");
                        central.removeListener('receiveIP' + destUsername, cb_wrap);
                        callback(false, ip);
                    });
                    central.emit('getIP', destUsername);
                },
                function (callback) { 
                    getCentralServer().on('recvPubKey' + destUsername, function sendMsg(pukey) {
                        console.log("recvPubKey"+destUsername+" event occured");
                        getCentralServer().removeListener('recvPubKey'+destUsername, sendMsg);
                        callback(false, pukey);
                    });
                    getCentralServer().emit('getPubKey', destUsername);
                }],
                function (err, res) {
                    if (!err) {
                        var ip = res[0];
                        var pukey = res[1];
                        console.log("ip is "+ip);
                        var friendSock = getClientIO(ip, PEER_SERVER_SOCK_PORT); 
                        console.log("in recvPubKey callback");
                        if (pukey == "error") {
                            console.log("Cannot send message. No public key found!");
                        } else {
                            console.log("Data to be sent to " + destUsername + " is " + msg);
                            var crypto = require('./crypt.js');
                            var encryptedMsg = crypto.encrypt(msg, pukey);
                            friendSock.emit(eventName, encryptedMsg, "dummySignature");
                            //console.log("emitting "+encryptedMsg+" on event "+eventName+" ip "+ friendSock.handshake.address + " port "+friendSock.handshake.address);
                        }
                    }
                });

    } else {
        getUserIp(destUsername,function(ip) {
            var friendSock = getClientIO(ip, PEER_SERVER_SOCK_PORT);  
            console.log("Data to be sent to " + destUsername + " is " + msg);
            friendSock.emit(eventName, msg);
        });
    }
};
exports.send = send;

