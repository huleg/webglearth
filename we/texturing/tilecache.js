
/**
 * @fileoverview Object serving as level 2 cache for given TileProvider.
 *
 * @author Petr Sloup <petr.sloup@klokantech.com>
 *
 */

goog.provide('we.texturing.TileCache');

goog.require('goog.array');
goog.require('goog.debug.Logger');
goog.require('goog.structs.Map');

goog.require('we.texturing.Tile');
goog.require('we.texturing.Tile.State');
goog.require('we.texturing.TileProvider');



/**
 * Object serving as level 2 cache for the TileProvider.
 * @param {!we.texturing.TileProvider} tileprovider TileProvider to be cached.
 * @constructor
 */
we.texturing.TileCache = function(tileprovider) {
  /**
   * @type {!goog.structs.Map}
   * @private
   */
  this.tileMap_ = new goog.structs.Map();

  /**
   * @type {!Array.<we.texturing.Tile>}
   * @private
   */
  this.loadRequests_ = [];

  /**
   * @type {number}
   */
  this.targetSize = 1024;

  /**
   * @type {goog.Timer}
   * @private
   */
  this.cleanTimer_ = new goog.Timer(20000);

  goog.events.listen(this.cleanTimer_, goog.Timer.TICK,
                     this.cleanCache, false, this);

  this.cleanTimer_.start();

  this.setTileProvider(tileprovider);
};


/**
 * Change TileProvider on-the-fly
 * @param {!we.texturing.TileProvider} tileprovider TileProvider to be set.
 */
we.texturing.TileCache.prototype.setTileProvider = function(tileprovider) {
  this.tileProviderResetTime_ = goog.now();
  this.tileProvider_ = tileprovider;
  this.tileProvider_.tileLoadedHandler = goog.bind(this.tileLoaded_, this);
  this.tileMap_.clear();
  this.loadRequests_ = [];
};


/**
 * @type {we.texturing.TileProvider}
 * @private
 */
we.texturing.TileCache.prototype.tileProvider_ = null;


/**
 * @type {number}
 * @private
 */
we.texturing.TileCache.prototype.tileProviderResetTime_ = 0;


/**
 * @type {!function(we.texturing.Tile)}
 */
we.texturing.TileCache.prototype.tileCachedHandler = goog.nullFunction;


/**
 * Returns the tile from cache if available.
 * @param {string} key Key.
 * @return {we.texturing.Tile} Tile from cache.
 */
we.texturing.TileCache.prototype.getTileFromCache = function(key) {
  return /** @type {we.texturing.Tile} */ (this.tileMap_.get(key));
};


/**
 * Removes LRU tiles from cache
 */
we.texturing.TileCache.prototype.cleanCache = function() {
  if (goog.DEBUG) {
    we.texturing.TileCache.logger.info('Cleaning cache..');
  }

  // The filtering is here just to be on the safe side. Buffered tiles wouldn't
  // probably get removed due to high request times, but it would be VERY bad.
  var cleanable = goog.array.filter(this.tileMap_.getValues(),
      function(tile, i, array) {
        return tile.state == we.texturing.Tile.State.LOADED ||
            tile.state == we.texturing.Tile.State.PREPARING ||
            tile.state == we.texturing.Tile.State.ERROR;
      });

  goog.array.sort(cleanable, function(tile1, tile2) {
    return tile1.requestTime - tile2.requestTime;
  });

  while (this.tileMap_.getCount() > this.targetSize && cleanable.length > 0) {
    var tile = cleanable.shift();
    if (tile.state == we.texturing.Tile.State.PREPARING) {
      goog.array.remove(this.loadRequests_, tile);
    }
    this.tileMap_.remove(tile.getKey());
    tile.dispose();
  }
};


/**
 * Returns tile from cache or starts loading it if not available
 * @param {number} zoom Zoom.
 * @param {number} x X.
 * @param {number} y Y.
 * @param {number} requestTime Time of the request, used as priority.
 * @return {!we.texturing.Tile} Requested tile.
 */
we.texturing.TileCache.prototype.retrieveTile = function(zoom, x, y,
                                                         requestTime) {
  var key = we.texturing.Tile.createKey(zoom, x, y);
  var tile = this.getTileFromCache(key);
  if (!goog.isDefAndNotNull(tile)) {
    tile = new we.texturing.Tile(zoom, x, y, requestTime);
    this.tileMap_.set(key, tile);
    this.loadRequests_.push(tile);
  } else {
    tile.requestTime = requestTime;
  }
  return tile;
};


/**
 * Tries to update tile's request time. If the tile is
 * not present in cache, this function has no sideeffect.
 * @param {string} key Tile's key.
 * @param {number} requestTime Request time to be set.
 */
we.texturing.TileCache.prototype.updateRequestTime = function(key,
                                                              requestTime) {
  var tile = this.getTileFromCache(key);
  if (goog.isDefAndNotNull(tile)) {
    tile.requestTime = requestTime;
  }
};


/**
 * Callback for loaded tiles.
 * @param {!we.texturing.Tile} tile Loaded tile.
 * @private
 */
we.texturing.TileCache.prototype.tileLoaded_ = function(tile) {
  // To prevent caching late-arriving tiles.
  if (tile.requestTime < this.tileProviderResetTime_) {
    if (goog.DEBUG) {
      we.texturing.TileCache.logger.info('Ignoring late tile..');
    }
    tile.state = we.texturing.Tile.State.ERROR;
    return;
  }

  this.tileCachedHandler(tile);
};


/**
 * Removes old tiles from queue
 * @param {number} timeLimit Time limit in ms.
 */
we.texturing.TileCache.prototype.purgeNotLoadedTiles = function(timeLimit) {
  var time = goog.now() - timeLimit;
  while (this.loadRequests_.length > 0 &&
      this.loadRequests_[0].requestTime < time) {
    var tile = this.loadRequests_.shift();
    this.tileMap_.remove(tile.getKey());
    tile.dispose();
  }
};


/**
 * Ensures that the right amount of tiles is loading.
 * @param {number} tilesToBeLoading Number of tiles to be should be loading.
 */
we.texturing.TileCache.prototype.processLoadRequests =
    function(tilesToBeLoading) {

  goog.array.sort(this.loadRequests_,
                  function(tile1, tile2) {
                    return tile1.requestTime - tile2.requestTime;
                  });

  var n = Math.min(this.loadRequests_.length,
                   tilesToBeLoading - this.tileProvider_.loadingTileCounter);
  for (var i = 0; i < n; i++) {
    var tile = this.loadRequests_.pop();
    if (!this.tileProvider_.loadTile(tile)) {
      this.loadRequests_.push(tile);
    }
  }
};


if (goog.DEBUG) {
  /**
   * Shared logger instance
   * @type {goog.debug.Logger}
   */
  we.texturing.TileCache.logger =
      goog.debug.Logger.getLogger('we.texturing.TileCache');
}
