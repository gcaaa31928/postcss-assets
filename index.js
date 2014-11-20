var vendor = require('postcss/lib/vendor');

var mapFunctions = require('./lib/mapFunctions');
var parseBytes = require('./lib/parseBytes');
var unescapeCss = require('./lib/unescapeCss');

var fs = require('fs');
var path = require('path');
var url = require('url');

var base64 = require('js-base64').Base64;
var cssesc = require('cssesc');
var mime = require('mime');
var sizeOf = require('image-size');

module.exports = function (options) {

  options = options || {};
  options.baseUrl = options.baseUrl || '/';

  if (options.basePath) {
    options.basePath = path.resolve(options.basePath);
  } else {
    options.basePath = process.cwd();
  }

  if (options.loadPaths) {
    options.loadPaths = options.loadPaths.map(function (loadPath) {
      return path.resolve(options.basePath, loadPath);
    });
  } else {
    options.loadPaths = [];
  }
  options.loadPaths.unshift(options.basePath);

  if (options.relativeTo) {
    options.relativeTo = path.resolve(options.relativeTo);
  } else {
    options.relativeTo = false;
  }

  function matchPath(assetPath) {
    var exception, matchingPath;
    var isFound = options.loadPaths.some(function (loadPath) {
      matchingPath = path.join(loadPath, assetPath);
      return fs.existsSync(matchingPath);
    });
    if (!isFound) {
      exception = new Error("Asset not found or unreadable: " + assetPath);
      exception.name = 'ENOENT';
      throw exception;
    }
    return matchingPath;
  }

  function resolveDataUrl(assetStr) {
    var resolvedPath = resolvePath(assetStr);
    var mimeType = mime.lookup(resolvedPath);
    if (mimeType === 'image/svg+xml') {
      var data = cssesc(fs.readFileSync(resolvedPath).toString());
      var encoding = 'utf8';
    } else {
      data = base64.encode(fs.readFileSync(resolvedPath));
      encoding = 'base64';
    }
    return 'data:' + mimeType + ';' + encoding + ',' + data;
  }

  function resolvePath(assetStr) {
    var assetUrl = url.parse(unescapeCss(assetStr));
    var assetPath = decodeURI(assetUrl.pathname);
    return matchPath(assetPath);
  }

  function resolveUrl(assetStr) {
    var assetUrl = url.parse(unescapeCss(assetStr));
    var assetPath = decodeURI(assetUrl.pathname);
    if (options.relativeTo) {
      assetUrl.pathname = path.relative(options.relativeTo, matchPath(assetPath));
    } else {
      var baseToAsset = path.relative(options.basePath, matchPath(assetPath));
      assetUrl.pathname = url.resolve(options.baseUrl, baseToAsset);
    }
    return cssesc(url.format(assetUrl));
  }

  function shouldBeInline(assetPath) {
    if (options.inline && options.inline.maxSize) {
      var size = fs.statSync(assetPath).size;
      return (size <= parseBytes(options.inline.maxSize));
    }
    return false;
  }

  return function (cssTree) {
    cssTree.eachDecl(function (decl) {

      decl.value = mapFunctions(decl.value, function (name, before, quote, assetStr, after) {

        try {

          var assetPath = resolvePath(assetStr);

          try {

            if (name === 'width') {
              return sizeOf(assetPath).width + 'px';
            }

            if (name === 'height') {
              return sizeOf(assetPath).height + 'px';
            }

            if (name === 'size') {
              var size = sizeOf(assetPath);
              return size.width + 'px ' + size.height + 'px';
            }
          } catch (e) {
            var err = new Error("Image corrupted: " + assetPath);
            err.name = 'ECORRUPT';
            throw err;
          }

          if (shouldBeInline(assetPath)) {
            return 'url(' + before + quote + resolveDataUrl(assetStr) + quote + after + ')';
          }

          return 'url(' + before + quote + resolveUrl(assetStr) + quote + after + ')';

        } catch (exception) {
          switch (exception.name) {
          case 'ECORRUPT':
            console.warn(exception.message);
            break;
          case 'ENOENT':
            console.warn('%s\nLoad paths:\n  %s', exception.message, options.loadPaths.join('\n  '));
            break;
          default:
            throw exception;
          }
        }
      });
    });
  };
};
