'use strict';

/**
 * Module dependencies.
 */

var Client = require('mongodb').MongoClient,
uri = require('mongodb-uri'),
thunky = require('thunky'),
zlib = require('zlib'), noop = function () {};

/**
 * Export `MongoStore`.
 */

exports = module.exports = {
  create : function (args) {
    return MongoStore(args);
  }
};

/**
 * MongoStore constructor.
 *
 * @param {Object} options
 * @api public
 */

function MongoStore(args) {

  if (!(this instanceof MongoStore))
    return new MongoStore(args);

  var store = this;
  var conn = (args.uri) ? args.uri : args;
  var options = (args.options) ? args.options : {};
  store.MongoOptions = options;
  store.name = 'mongodb';

  if ('object' === typeof conn) {
    if ('function' !== typeof conn.collection) {
      MongoOptions = conn.options;
      if (Object.keys(MongoOptions).length === 0) {
        conn = null;
      } else if (MongoOptions.client) {
        store.client = MongoOptions.client
      } else {
        store.MongoOptions.database = store.MongoOptions.database || store.MongoOptions.db;
        store.MongoOptions.hosts = store.MongoOptions.hosts || [{
              port : store.MongoOptions.port || 27017,
              host : store.MongoOptions.host || '127.0.0.1'
            }
          ];
        store.MongoOptions.hosts = store.MongoOptions.hosts || 3600;
        conn = uri.format(store.MongoOptions);
      }
    } else {
      store.client = conn;
    }
  }
  conn = conn || 'mongodb://127.0.0.1:27017';
  store.coll = store.MongoOptions.collection || 'cacheman';
  store.compression = store.MongoOptions.compression || false;

  if ('string' === typeof conn) {
    Client.connect(conn, store.MongoOptions, function getDb(err, db) {
      store.client = db;
    });
  }

}

/**
 * Get an entry.
 *
 * @param {String} key
 * @param {Function} fn
 * @api public
 */

MongoStore.prototype.get = function get(key, options, fn) {

  if ('function' === typeof options) {
    fn = options;
    options = null;
  }
  fn = fn || noop;

  var store = this;

  store.client.collection(store.coll).findOne({
    key : key
  }, function findOne(err, data) {
    if (err)
      return fn(err);
    if (!data)
      return fn(null, null);
    if (data.expire < Date.now()) {
      store.del(key);
      return fn(null, null);
    }
    try {
      if (data.compressed)
        return decompress(data.value, fn);
      fn(null, data.value);
    } catch (err) {
      fn(err);
    }
  });
};

/**
 * Set an entry.
 *
 * @param {String} key
 * @param {Mixed} val
 * @param {Number} ttl
 * @param {Function} fn
 * @api public
 */

MongoStore.prototype.set = function set(key, val, options, fn) {

  if ('function' === typeof options) {
    fn = options;
    options = null;
  }
  fn = fn || noop;

  var store = this;
  var ttl = (options && (options.ttl || options.ttl === 0)) ? options.ttl : store.MongoOptions.ttl;

  var data,
  query = {
    key : key
  },
  options = {
    upsert : true,
    safe : true
  };

  try {
    data = {
      key : key,
      value : val,
      expire : Date.now() + ((ttl || 60) * 1000)
    };
  } catch (err) {
    return fn(err);
  }

  if (!store.compression) {
    update(data);
  } else {
    compress(data, function compressData(err, data) {
      if (err)
        return fn(err);
      update(data);
    });
  }

  function update(data) {
    store.client.collection(store.coll).update(query, data, options, function _update(err, data) {

      if (err)
        return fn(err);
      if (!data)
        return fn(null, null);
      fn(null, val);
    });
  }
};

/**
 * Delete an entry.
 *
 * @param {String} key
 * @param {Function} fn
 * @api public
 */

MongoStore.prototype.del = function del(key, options, fn) {
  if (typeof options === 'function') {
    fn = options;
  }
  var store = this;
  fn = fn || noop;
  this.ready(function ready(err, db) {
    if (err)
      return fn(err);
    db.collection(store.coll).remove({
      key : key
    }, {
      safe : true
    }, fn);
  });
};

/**
 * Clear all entries for this bucket.
 *
 * @param {String} key
 * @param {Function} fn
 * @api public
 */

MongoStore.prototype.reset = function reset(key, fn) {
  var store = this;

  if ('function' === typeof key) {
    fn = key;
    key = null;
  }

  fn = fn || noop;
  store.ready(function ready(err, db) {
    if (err)
      return fn(err);
    db.collection(store.coll).remove({}, {
      safe : true
    }, fn);
  });
};

MongoStore.prototype.isCacheableValue = function (value) {
  return value !== null && value !== undefined;
};

/**
 * Non-exported Helpers
 */

/**
 * Compress data value.
 *
 * @param {Object} data
 * @param {Function} fn
 * @api public
 */

function compress(data, fn) {

  // Data is not of a "compressable" type (currently only Buffer)
  if (!Buffer.isBuffer(data.value))
    return fn(null, data);

  zlib.gzip(data.value, function (err, val) {
    // If compression was successful, then use the compressed data.
    // Otherwise, save the original data.
    if (!err) {
      data.value = val;
      data.compressed = true;
    }

    fn(err, data);
  });
};

/**
 * Decompress data value.
 *
 * @param {Object} value
 * @param {Function} fn
 * @api public
 */

function decompress(value, fn) {
  var v = (value.buffer && Buffer.isBuffer(value.buffer)) ? value.buffer : value;
  zlib.gunzip(v, fn);
};
