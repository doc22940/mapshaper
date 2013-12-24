/* @requires mapshaper-shape-geom, mapshaper-shapes */

MapShaper.compileLayerExpression = function(exp, arcs) {
  var env = new LayerExpressionContext(arcs),
      func;
  try {
    func = new Function("env", "with(env){return " + exp + ";}");
  } catch(e) {
    message('Error compiling expression "' + exp + '"');
    stop(e);
  }

  return function(lyr) {
    var value;
    env.__setLayer(lyr);
    try {
      value = func.call(env, env);
    } catch(e) {
      stop(e);
    }
    return value;
  };
};

MapShaper.compileFeatureExpression = function(exp, arcs, shapes, records) {
  if (arcs instanceof ArcDataset === false) error("[compileFeatureExpression()] Missing ArcDataset;", arcs);
  var newFields = exp.match(/[A-Za-z_][A-Za-z0-9_]*(?= *=[^=])/g) || [],
      env = new FeatureExpressionContext(arcs),
      func;

  exp = MapShaper.removeExpressionSemicolons(exp);
  try {
    func = new Function("record,env", "with(env){with(record) { return " + exp + ";}}");
  } catch(e) {
    message('Error compiling expression "' + exp + '"');
    stop(e);
  }

  return function(shapeId) {
    var shape = shapes[shapeId],
        record = records[shapeId],
        value, f;
    for (var i=0; i<newFields.length; i++) {
      f = newFields[i];
      if (f in record === false) {
        record[f] = null;
      }
    }
    env.__setShape(shape, shapeId);
    try {
      value = func.call(env, record, env);
    } catch(e) {
      stop(e);
    }
    return value;
  };
};

// Semicolons that divide the expression into two or more js statements
// cause problems when 'return' is added before the expression
// (only the first statement is evaluated). Replacing with commas fixes this
//
MapShaper.removeExpressionSemicolons = function(exp) {
  if (exp.indexOf(';') != -1) {
    // remove any ; from end of expression
    exp = exp.replace(/[; ]+$/, '');
    // change any other semicolons to commas
    // (this is not very safe -- what if a string literal contains a semicolon?)
    exp = exp.replace(/;/g, ',');
  }
  return exp;
};

function hideGlobals(obj) {
  // Can hide global properties during expression evaluation this way
  // (is this worth doing?)
  Utils.extend(obj, {
    global: null,
    window: null,
    setTimeout: null,
    setInterval: null
  });
}

function addGetters(obj, getters) {
  Utils.forEach(getters, function(f, name) {
    Object.defineProperty(obj, name, {get: f});
  });
}

function FeatureExpressionContext(arcs) {
  var _shp = new MultiShape(arcs),
      _self = this,
      _centroid, _innerXY,
      _i, _ids, _bounds;

  this.$ = this;
  hideGlobals(this);

  // TODO: add methods:
  // isClosed / isOpen
  //
  addGetters(this, {
    id: function() {
      return _id;
    },
    // TODO: count hole/s + containing ring as one part
    partCount: function() {
      return _shp.pathCount;
    },
    isNull: function() {
      return _shp.pathCount === 0;
    },
    bounds: function() {
      return shapeBounds().toArray();
    },
    width: function() {
      return shapeBounds().width();
    },
    height: function() {
      return shapeBounds().height();
    },
    area: function() {
      return MapShaper.getShapeArea(_ids, arcs);
    },
    originalArea: function() {
      var i = arcs.getRetainedInterval(),
          area;
      arcs.setRetainedInterval(0);
      area = _self.area;
      arcs.setRetainedInterval(i);
      return area;
    },
    centroidX: function() {
      var p = centroid();
      return p ? p.x : null;
    },
    centroidY: function() {
      var p = centroid();
      return p ? p.y : null;
    },
    interiorX: function() {
      var p = innerXY();
      return p ? p.x : null;
    },
    interiorY: function() {
      var p = innerXY();
      return p ? p.y : null;
    }
  });

  this.__setShape = function(shp, id) {
    _bounds = null;
    _centroid = null;
    _innerXY = null;
    _ids = shp;
    _id = id;
    _shp.init(shp);
  };

  function centroid() {
    _centroid = _centroid || MapShaper.getShapeCentroid(_ids, arcs);
    return _centroid;
  }

  function innerXY() {
    //_innerXY = centroid(); // TODO: implement
    return null;
  }

  function shapeBounds() {
    if (!_bounds) {
      _bounds = arcs.getMultiShapeBounds(_ids);
    }
    return _bounds;
  }
}

function LayerExpressionContext(arcs) {
  var shapes, properties, lyr;
  hideGlobals(this);
  this.$ = this;

  this.sum = function(exp) {
    return reduce(exp, 0, function(accum, val) {
      return accum + (val || 0);
    });
  };

  this.min = function(exp) {
    var min = reduce(exp, Infinity, function(accum, val) {
      return Math.min(accum, val);
    });
    return min;
  };

  this.max = function(exp) {
    var max = reduce(exp, -Infinity, function(accum, val) {
      return Math.max(accum, val);
    });
    return max;
  };

  this.average = function(exp) {
    /*
    var avg = reduce(exp, NaN, function(accum, val, i) {
      if (i > 0) {
        val = val / (i+1) + accum * i / (i+1);
      }
      return val;
    });
    */
    var sum = this.sum(exp);
    return sum / shapes.length;
  };

  this.median = function(exp) {
    var arr = values(exp);
    return Utils.findMedian(arr);
  };

  this.__setLayer = function(layer) {
    lyr = layer;
    shapes = layer.shapes;
    properties = layer.data ? layer.data.getRecords() : [];
  };

  function values(exp) {
    var compiled = MapShaper.compileFeatureExpression(exp, arcs, shapes, properties);
    return Utils.repeat(shapes.length, compiled);
  }

  function reduce(exp, initial, func) {
    var val = initial,
        compiled = MapShaper.compileFeatureExpression(exp, arcs, shapes, properties);
    for (var i=0, n=shapes.length; i<n; i++) {
      val = func(val, compiled(i), i);
    }
    return val;
  }

  addGetters({
    bounds: function() {
      return MapShaper.calcLayerBounds(lyr, arcs).toArray();
    }
  });
}
