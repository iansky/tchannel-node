// Copyright (c) 2015 Uber Technologies, Inc.
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
// THE SOFTWARE.

'use strict';

var collectParallel = require('collect-parallel/array');

var allocCluster = require('./lib/alloc-cluster.js');

allocCluster.test('immediate peer.drain', {
    numPeers: 2,
    skipEmptyCheck: true
}, function t(cluster, assert) {
    var server = cluster.channels[0];
    setupTestClients(cluster, ['a'], runTest);
    setupServiceServer(server, 'a', 5);

    function runTest(err, clients) {
        if (err) {
            finish(err);
            return;
        }

        var peer = server.peers.get(clients.a[0].hostPort);
        assert.timeoutAfter(50);
        peer.drain({
            reason: 'testdown'
        }, drained);
    }

    function drained() {
        assert.pass('immediate drain happened');
        waitForConnRemoved(2, cluster, finish);
        server.close(closed);
    }

    function closed(err) {
        if (err) {
            finish(err);
            return;
        }
        assert.pass('server closed');
    }

    function finish(err) {
        checkFinish(assert, err, cluster, 1);
    }
});

allocCluster.test('drain server with a few incoming', {
    numPeers: 2,
    skipEmptyCheck: true
}, function t(cluster, assert) {
    var server = cluster.channels[0];
    var client = null;
    var peer = null;
    var finishCount = 0;
    var reqN = 0;
    setupTestClients(cluster, ['a'], runTest);
    setupServiceServer(server, 'a', 5);

    function runTest(err, clients) {
        if (err) {
            finish(err);
            return;
        }
        client = clients.a[0];
        peer = server.peers.get(client.hostPort);

        finishCount = 2;
        assert.timeoutAfter(50);
        reqN++;
        assert.comment('sending request ' + reqN);
        client.request().send('echo', 'such', 'mess' + reqN, sendDone);

        setTimeout(testdown, 1);
    }

    function testdown() {
        assert.comment('triggering drain');
        assert.equal(finishCount, 2, 'requests have not finished');
        peer.drain({
            reason: 'testdown'
        }, drained);
        finishCount++;
        reqN++;
        assert.comment('sending request ' + reqN);
        client.request().send('echo', 'such', 'mess' + reqN, afterDrainSendsDone);
    }

    function sendDone(err, res) {
        if (err) {
            finish(err);
            return;
        }

        assert.equal(
            res && String(res.arg3), 'mess1',
            'res: expected arg3');

        finish();
    }

    function afterDrainSendsDone(err, res) {
        assert.equal(
            err && err.type,
            'tchannel.declined',
            'err: expected declined');
        assert.equal(res && res.value, null, 'res: no value');
        finish();
    }

    function drained() {
        assert.pass('drain happened');
        waitForConnRemoved(2, cluster, finish);
        server.close(closed);
    }

    function closed(err) {
        if (err) {
            finish(err);
            return;
        }

        assert.pass('server closed');
    }

    function finish(err) {
        finishCount = checkFinish(assert, err, cluster, finishCount);
    }
});

allocCluster.test('drain server with a few incoming (with exempt service)', {
    numPeers: 2,
    skipEmptyCheck: true
}, function t(cluster, assert) {

    cluster.logger.whitelist('info', 'draining peer');
    cluster.logger.whitelist('info', 'ignoring outresponse.send on a closed connection');

    var server = cluster.channels[0];
    var clientA = null;
    var clientB = null;
    var peer = null;
    var finishCount = 0;
    var reqN = 0;
    setupTestClients(cluster, ['a', 'b'], runTest);
    setupServiceServer(server, 'a', 5);
    setupServiceServer(server, 'b', 5);
    server.drainExempt = drainExemptB;

    function runTest(err, clients) {
        if (err) {
            finish(err);
            return;
        }
        clientA = clients.a[0];
        clientB = clients.b[0];
        peer = server.peers.get(clientA.hostPort);

        assert.timeoutAfter(50);

        finishCount++;
        reqN++;
        assert.comment('sending request ' + reqN);
        clientA.request().send('echo', 'such', 'mess' + reqN, checkASend);

        finishCount++;
        reqN++;
        assert.comment('sending request ' + reqN);
        clientB.request().send('echo', 'such', 'mess' + reqN, checkBSend);

        setTimeout(testdown, 1);

        function checkASend(err, res) {
            assert.ifError(err, 'service:a no error');
            assert.equal(res && String(res.arg3), 'mess1',
                         'service:a expected arg3');
            finish();
        }

        function checkBSend(err, res) {
            if (err) {
                assert.ok(err.type === 'tchannel.connection.reset' ||
                    err.type === 'tchannel.request.timeout',
                    'service:b expected connection reset or request timeout error');
            } else {
                assert.equal(String(res.arg3), 'mess1',
                             'service:b expected arg3');
            }
            finish();
        }
    }

    function testdown() {
        assert.comment('triggering drain');
        assert.equal(finishCount, 2, 'requests have not finished');

        finishCount++;
        peer.drain({
            reason: 'testdown'
        }, drained);

        finishCount++;
        reqN++;
        assert.comment('sending request ' + reqN);
        clientA.request().send('echo', 'such', 'mess' + reqN, checkADecline);

        finishCount++;
        reqN++;
        assert.comment('sending request ' + reqN);
        clientB.request().send('echo', 'such', 'mess' + reqN, checkBRes);

        function checkADecline(err, res) {
            assert.equal(err && err.type, 'tchannel.declined',
                         'service:a expected declined');
            assert.equal(res, null,
                         'service:a no value');
            finish();
        }

        function checkBRes(err, res) {
            if (err) {
                assert.ok(err.type === 'tchannel.connection.reset' ||
                    err.type === 'tchannel.request.timeout',
                    'service:b expected connection reset error');
            } else {
                assert.equal(String(res.arg3), 'mess10',
                             'service:b expected arg3');
            }
            finish();
        }
    }

    function drainExemptB(req) {
        return req.serviceName === 'b';
    }

    function drained() {
        assert.pass('drain happened');
        waitForConnRemoved(2, cluster, finish);
        server.close(closed);
    }

    function closed(err) {
        if (err) {
            finish(err);
            return;
        }
        assert.pass('server closed');

        var logs = cluster.logger.items().map(function eachLog(log) {
            return {
                level: log.levelName,
                msg: log.msg
            };
        });

        assert.ok(logs.length > 0, 'expected some logs');
        assert.deepEqual(logs[0], {
            level: 'info',
            msg: 'draining peer'
        }, 'expected draining log');

        for (var i = 1; i < logs.length; i++) {
            assert.deepEqual(logs[i], {
                level: 'info',
                msg: 'ignoring outresponse.send on a closed connection'
            }, 'expected zero or more sends after close');
        }
    }

    function finish(err) {
        finishCount = checkFinish(assert, err, cluster, finishCount);
    }
});

allocCluster.test('drain client with a few outgoing', {
    numPeers: 2,
    skipEmptyCheck: true
}, function t(cluster, assert) {
    var server = cluster.channels[0];
    var drainClient = cluster.channels[1];
    var client = null;
    var peer = null;
    var finishCount = 0;
    var reqN = 0;
    setupTestClients(cluster, ['a'], runTest);
    setupServiceServer(server, 'a', 5);

    function runTest(err, clients) {
        if (err) {
            finish(err);
            return;
        }
        client = clients.a[0];
        peer = client.peers.get(server.hostPort);

        finishCount = 2;
        assert.timeoutAfter(50);
        reqN++;
        assert.comment('sending request ' + reqN);
        client.request().send('echo', 'such', 'mess' + reqN, sendDone);

        setTimeout(testdown, 1);
    }

    function testdown() {
        assert.comment('triggering drain');
        assert.equal(finishCount, 2, 'requests have not finished');
        peer.drain({
            reason: 'testdown'
        }, drained);
        finishCount++;
        reqN++;
        assert.comment('sending request ' + reqN);
        client.request().send('echo', 'such', 'mess' + reqN, afterDrainSendDone);
    }

    function sendDone(err, res) {
        assert.ifError(err, 'res: no error');
        assert.equal(
            res && String(res.arg3), 'mess1',
            'res: expected arg3');
        finish();
    }

    function afterDrainSendDone(err, res) {
        assert.equal(
            err && err.type,
            'tchannel.request.drained',
            'err: expected request drained');
        assert.equal(res, null, 'no res');
        finish();
    }

    function drained() {
        assert.pass('drain happened');
        waitForConnRemoved(2, cluster, finish);
        drainClient.close(closed);
    }

    function closed(err) {
        if (err) {
            finish(err);
            return;
        }

        assert.pass('client closed');
    }

    function finish(err) {
        assert.ifError(err, 'no unexpected error');

        if (--finishCount === 0) {
            // cluster.assertEmptyState(assert);
            // return;

            cluster.assertCleanState(assert, {
                channels: [
                    // server has no peers
                    {peers: [
                        {connections: []}
                    ]},
                    // all client connections closed
                    {peers: []}
                ]
            });

            assert.end();
        }
    }
});

allocCluster.test('drain client with a few outgoing (with exempt service)', {
    numPeers: 2,
    skipEmptyCheck: true
}, function t(cluster, assert) {
    var server = cluster.channels[0];
    var drainClient = cluster.channels[1];
    var clientA = null;
    var clientB = null;
    var peer = null;
    var finishCount = 0;
    var reqN = 0;
    setupTestClients(cluster, ['a', 'b'], runTest);
    drainClient.drainExempt = drainExemptB;
    setupServiceServer(server, 'a', 5);
    setupServiceServer(server, 'b', 5);
    server.drainExempt = drainExemptB;

    cluster.logger.whitelist('info', 'resetting connection');
    // cluster.logger.whitelist('info', 'ignoring outresponse.send on a closed connection');

    function runTest(err, clients) {
        if (err) {
            finish(err);
            return;
        }
        clientA = clients.a[0];
        clientB = clients.b[0];
        peer = clientA.peers.get(server.hostPort);

        assert.timeoutAfter(50);

        finishCount++;
        reqN++;
        assert.comment('sending request ' + reqN);
        clientA.request().send('echo', 'such', 'mess' + reqN, checkASend);

        finishCount++;
        reqN++;
        assert.comment('sending request ' + reqN);
        clientB.request().send('echo', 'such', 'mess' + reqN, checkBSend);

        setTimeout(testdown, 1);

        function checkASend(err, res) {
            assert.ifError(err, 'service:a no error');
            assert.equal(res && String(res.arg3), 'mess1',
                         'service:a expected arg3');
            finish();
        }

        function checkBSend(err, res) {
            if (err) {
                assert.ok(err.type === 'tchannel.local.reset' ||
                    err.type === 'request.timeout',
                    'service:b expected local reset or request timeout error');
            } else {
                assert.equal(String(res.arg3), 'mess4',
                             'service:b expected arg3');
            }
            finish();
        }
    }

    function testdown() {
        assert.comment('triggering drain');
        assert.equal(finishCount, 2, 'requests have not finished');

        finishCount++;
        peer.drain({
            reason: 'testdown'
        }, drained);

        finishCount++;
        reqN++;
        assert.comment('sending request ' + reqN);
        clientA.request().send('echo', 'such', 'mess' + reqN, checkADecline );

        finishCount++;
        reqN++;
        assert.comment('sending request ' + reqN);
        clientB.request().send('echo', 'such', 'mess' + reqN, checkBRes);

        function checkADecline(err, res) {
            assert.equal(err && err.type, 'tchannel.request.drained',
                         'service:a expected request drained');
            assert.equal(res, null,
                         'service:a no value');
            finish();
        }

        function checkBRes(err, res) {
            if (err) {
                assert.equal(err.type, 'tchannel.local.reset',
                             'service:b expected local reset error');
            } else {
                assert.equal(String(res.arg3), 'mess10',
                             'service:b expected arg3');
            }
            finish();
        }
    }

    function drainExemptB(req) {
        return req.serviceName === 'b';
    }

    function drained() {
        assert.pass('drain happened');
        waitForConnRemoved(2, cluster, finish);
        drainClient.close(closed);
    }

    function closed(err) {
        if (err) {
            finish(err);
            return;
        }

        assert.pass('client closed');
    }

    function checkLogs() {
        var logs = cluster.logger.items().map(function eachLog(log) {
            return {
                level: log.levelName,
                msg: log.msg
            };
        });

        // TODO: why not always get log
        if (logs.length > 0) {
            assert.deepEqual(logs[0], {
                level: 'info',
                msg: 'resetting connection'
            }, 'expected resetting connection log');
        }
    }

    function finish(err) {
        assert.ifError(err, 'no unexpected error');

        if (--finishCount === 0) {
            // cluster.assertEmptyState(assert);
            // return;

            checkLogs();

            cluster.assertCleanState(assert, {
                channels: [
                    // server has no peers
                    {peers: [
                        {connections: []}
                    ]},
                    // all client connections closed
                    {peers: []}
                ]
            });

            assert.end();
        }
    }
});

// TODO: test draining of outgoing reqs

function setupTestClients(cluster, services, callback) {
    var i;
    var clients = {};
    var serverRoot = cluster.channels[0];

    for (i = 0; i < services.length; i++) {
        var service = services[i];
        var clis = clients[service] = [];
        for (var j = 1; j < cluster.channels.length; j++) {
            var client = setupServiceClient(cluster.channels[j], service);
            clis.push(client);
            client.peers.add(serverRoot.hostPort);
        }
    }

    collectParallel(cluster.channels.slice(1), idEach, ided);

    function idEach(chan, i, done) {
        var peer = chan.peers.add(serverRoot.hostPort);
        peer.waitForIdentified(done);
    }

    function ided(err, res) {
        for (var i = 0; i < res.length; i++) {
            if (res[i].err) {
                callback(res[i].err, clients);
                return;
            }
        }
        callback(null, clients);
    }
}

function setupServiceServer(rootchan, service, delay) {
    var chan = rootchan.makeSubChannel({
        serviceName: service
    });
    chan.register('echo', echo);

    return chan;

    function echo(req, res, arg2, arg3) {
        req.channel.timers.setTimeout(respond, delay);

        function respond() {
            res.headers.as = 'raw';
            res.send(arg2, arg3);
        }
    }
}

function setupServiceClient(rootchan, service) {
    return rootchan.makeSubChannel({
        serviceName: service,
        requestDefaults: {
            timeout: 100,
            hasNoParent: true,
            retryflags: {
                never: true
            },
            serviceName: service,
            headers: {
                as: 'raw',
                cn: service + 'Client'
            }
        }
    });
}

function checkFinish(assert, err, cluster, finishCount) {
    assert.ifError(err, 'no unexpected error');

    if (--finishCount === 0) {
        cluster.assertCleanState(assert, {
            channels: [
                // server has no peers
                {peers: []},
                // all client connections closed
                {peers: [{connections: []}]},
                {peers: [{connections: []}]},
                {peers: [{connections: []}]}
            ]
        });

        assert.end();
    }

    return finishCount;
}

function waitForConnRemoved(count, cluster, callback) {
    cluster.channels.forEach(function eachChannel(chan) {
        var peers = chan.peers.values();
        peers.forEach(function eachPeer(peer) {
            peer.on('removeConnection', removed);
        });
    });

    function removed() {
        if (--count <= 0) {
            callback(null);
        }
    }
}
