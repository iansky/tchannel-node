// Copyright (c) 2017 Uber Technologies, Inc.
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

var test = require('tape');

var TChannel = require('../../');
var HyperbahnClient = require('../../hyperbahn/index.js');

test('getting client subChannel without serviceName', function t(assert) {
    var client = HyperbahnClient({
        tchannel: TChannel(),
        serviceName: 'foo',
        callerName: 'foo-test',
        hostPortList: []
    });

    assert.throws(function throwIt() {
        client.getClientChannel();
    }, /must pass serviceName/);

    assert.throws(function throwIt() {
        client.getClientChannel({});
    }, /must pass serviceName/);

    client.tchannel.close();
    assert.end();
});

test('getting a client subChannel', function t(assert) {
    var client = HyperbahnClient({
        tchannel: TChannel(),
        serviceName: 'foo',
        callerName: 'foo-test',
        hostPortList: []
    });

    var subChannel = client.getClientChannel({
        serviceName: 'bar'
    });

    assert.equal(subChannel.topChannel, client.tchannel);

    client.tchannel.close();
    assert.end();
});

test('double getting a client subChannel', function t(assert) {
    var client = HyperbahnClient({
        tchannel: TChannel(),
        serviceName: 'foo',
        callerName: 'foo-test',
        hostPortList: []
    });

    var subChannel1 = client.getClientChannel({
        serviceName: 'bar'
    });
    var subChannel2 = client.getClientChannel({
        serviceName: 'bar'
    });

    assert.equal(subChannel1, subChannel2);

    client.tchannel.close();
    assert.end();
});
