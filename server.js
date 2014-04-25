/* --- Constants --- */
const REDIS_PORT = '6379';
const BACKEND_SOCK_PORT = 8081;
const PEER_SERVER_SOCK_PORT = 8082;
const USER_PORT = 5008;
const FOLLOW_USER = 'FollowUser';
const UPDATE_STATUS = 'UpdateStatus';
const CENTRAL_SERVER_IP = 'peernet.herokuapp.com';
const CENTRAL_SERVER_PORT = '80';

/* --- Modules and Settings --- */
var express = require('express');
var http = require('http');
var mp = require('./mp.js');
var app = express();
var server = http.createServer(app);
var io = require('socket.io').listen(server);
var redis = require("redis");
var redisClient = redis.createClient(REDIS_PORT, 'localhost');
var async = require('async');

var crypt = require('./crypt.js');


//var fakeCentralServer = require('../utils/fakeserver.js').makeFakeCentralServer();
app.use(express.json()); // to support JSON-encoded bodies
app.use(express.urlencoded()); // to support URL-encoded bodies
app.set('view engine', 'jade');
app.set('view options', { layout: true });
app.set('views', __dirname + '/views');
app.use(express.static(__dirname + '/static')); 

/* --- Helper Functions --- */

/* A constructor for User class */
function User(name, ipaddr) {
    this.name = name;
    this.ipaddr = ipaddr;
}

/* A constructor for Status class */
function Status(author, time, text) {
    this.author = author;
    this.time = time;
    this.text = text;
}

/**
 * callWhenDone: a simple synchronized callback closure
 * @author adrienjoly
 * example use:
 * var sync = callWhenDone(function () { console.log("all jobs are done!"); });
 * var endJob = function (){ console.log("one job ended"); sync(-1); };
 * for (var i=0; i<10; ++i) {
 *     sync(+1);
 *     setTimeout(endJob, Math.random()*10000); // to replace with your async function
 * }
 */
var callWhenDone = function (callback) {
    var counter = 0;
    return function (incr) {
        if (0 == (counter += incr))
            callback();
    };
};

/* get public local IP address */
function getHostIp() {
    var os = require('os');
    var ifaces = os.networkInterfaces();
    for (var dev in ifaces) {
        var ip;
        ifaces[dev].forEach(function (details) {
            if (details.family == 'IPv4') {
                if (details.address.substring(0, 3) != '127') {
                    ip = details.address;
                }
            }
        });
    }
    return ip;
}

/* --- Web Entry Points --- */

/* Login page */
app.get('/login', function (req, res) {
    res.render('login');
});
app.post('/login', function (req, res) {
    login(req.body.username, req.body.password, res);
});

/* Homepage, default to Status page */
app.get('/', function (req, res) {
    getStatus(function (statuses) {
        res.render('status', { 'statuses': statuses });
    });
});

/* Status page */
app.get('/status', function (req, res) {
    getStatus(function (statuses) {
        res.render('status', { 'statuses': statuses });
    });
});
app.post('/status', function (req, res) {
    multicastStatus(req.body.status);
    updateStatus(req.body.status, function (statuses) {
        res.render('status', { 'statuses': statuses } );
    });
});

/* Following page */
app.get('/following', function (req, res) {
    getFollowees(function (followees) {
        res.render('following', { 'followings': followees });
    });
});
app.post('/following', function (req, res) {
    var followee = req.body.followee;
    mp.send(FOLLOW_USER, followee, false, username);
    updateFollowees(followee, function (followees) {
        res.render('following', { 'followings': followees });
    })
});

/* Followers page */
app.get('/followers', function (req, res) {
    getFollowers(function (followers) {
        res.render('followers', { 'followers': followers });
    });
});

/* Messages page */
app.get('/messages', function (req, res) {
    res.render('messages');
});

/* Events page */
app.get('/events', function (req, res) {
    res.render('events');
});

/* --- Feature Implementations --- */

/* Login to the centralized server */
function login(username, password, res) {
    //fakeCentralServer.updateUserIp(username, getHostIp());


    //res.render('login_success');


    crypt.init(username);

    var loginSock = mp.getClientIO(CENTRAL_SERVER_IP, CENTRAL_SERVER_PORT);
    loginSock.emit('authenticate', username, password, getHostIp());
    loginSock.on('auth', function (data, flag) {
        if (flag == 1) {
            res.render('login_success');
        } else {
            res.render('login_fail');
        }
    });

}

/* Multicast status updates to followers. */
function multicastStatus(status) {
    getFollowers(function (followers) {
        for (var i in followers) {
            console.log('sending status update to' + followers[i].name);
            //fakeCentralServer.getUserIp(followers[i].name, function (followerIp) {
            mp.send(UPDATE_STATUS, followers[i].name, true, username + '+' + status);
            //});
        }
    });
}

/* Users can get status from redis. */
function getStatus(fn) {
    var statuses = [];
    async.series([
            function (callback) {
                redisClient.zrevrange(status_key, 0, -1, function (err, res) {
                    callback(err, res);
                });
            }],
            function (err, res) {
                if (!err) {
                    res[0].forEach(function (e, i) {
                        var json = JSON.parse(e);
                        var date = new Date(json.time);
                        statuses.push(new Status(json.author, date.toString(), json.text));
                    });
                    fn(statuses);
                }
            });
}

/* Users can update status. Statuses are stored in an ordered set in redis. */
function updateStatus(status, fn) {
    var statuses = [];
    async.series([
            function (callback) {
                var status_time = (new Date()).getTime();
                var status_json = JSON.stringify({ 'author': username, 'time': status_time, 'text': status });
                redisClient.zadd(status_key, status_time, status_json, function (err, res) {
                    callback(err, res);
                });
            },
            function (callback) {
                redisClient.zrevrange(status_key, 0, -1, function (err, res) {
                    callback(err, res);
                });
            }],
            function (err, res) {
                if (!err) {
                    res[1].forEach(function (e, i) {
                        var json = JSON.parse(e);
                        var date = new Date(json.time);
                        statuses.push(new Status(json.author, date.toString(), json.text));
                    });
                    fn(statuses);
                }
            });
}

/* Users can follow other users. */
function updateFollowees(followee, fn) {
    var followees = [];
    async.series([
            function (callback) {
                redisClient.sadd(followee_key, followee, function (err, res) {
                    callback(err, res);
                });
            },
            function (callback) {
                redisClient.smembers(followee_key, function (err, res) {
                    callback(err, res);
                });
            }],
            function (err, results) {
                if (!err) {
                    results[1].forEach(function (e, i) {
                        var ipaddr = null;
                        followees.push(new User(e, ipaddr));
                    });
                    fn(followees);
                }
            });
}

/* Users can get her/his followees from local redis. */
function getFollowees(fn) {
    var followees = [];
    async.series([
            function (callback) {
                redisClient.smembers(followee_key, function (err, res) {
                    callback(err, res);
                })
            }],
            function (err, results) {
                if (!err) {
                    results[0].forEach(function (e, i) {
                        var ipaddr = null;
                        followees.push(new User(e, ipaddr));
                    });
                    fn(followees);
                }
            });
}

/* Users can get her/his followers from local redis. */
function getFollowers(fn) {
    var followers = [];
    async.series([
            function (callback) {
                redisClient.smembers(follower_key, function (err, res) {
                    callback(err, res);
                })
            }],
            function (err, results) {
                if (!err) {
                    results[0].forEach(function (e, i) {
                        var ipaddr = null;
                        followers.push(new User(e, ipaddr));
                    });
                    fn(followers);
                }
            });
}

var servers = { };
var clients = { };

var username = process.argv[2];
console.log('Your name is ' + username);

var backendSock = mp.getServerIO(BACKEND_SOCK_PORT);
var peerServerSock = mp.getServerIO(PEER_SERVER_SOCK_PORT);

var status_key = 'peernet:' + username + ':status';
var followee_key = 'peernet:' + username + ':followee';
var follower_key = 'peernet:' + username + ':follower';

server.listen(USER_PORT);
console.log('Listening on port ' + USER_PORT);

/* --- Socket.IO channels and events --- */
peerServerSock.on('connection', function (socket) {
    console.log("on server connection");
    socket.on(FOLLOW_USER, function (follower) {
        console.log("[" + follower + "] wants to follow me");
        redisClient.sadd(follower_key, follower);
    });
    socket.on(UPDATE_STATUS, function (msg) {
        var decrypted_msg = crypt.decrypt(msg);
        //var decrypted_msg = msg;
        var parsed_msg = decrypted_msg.split('+');
        var status_time = (new Date()).getTime();
        var status_json = JSON.stringify({ 'author': parsed_msg[0], 'time': status_time, 'text': parsed_msg[1] });
        console.log("received status update [" + parsed_msg[1] + "] from [" + parsed_msg[0] + "]");
        redisClient.zadd(status_key, status_time, status_json);
    });
});
