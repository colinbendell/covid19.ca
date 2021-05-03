const fs = require("fs");
const CleanCSS = require("clean-css");
const pluginNavigation = require("@11ty/eleventy-navigation");
const htmlmin = require("html-minifier");
const uglify = require("posthtml-minify-classnames")
const posthtml = require("posthtml")

const ISO_3_LETTER_MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

module.exports = function(eleventyConfig) {
  // Add plugins
  // eleventyConfig.addPlugin(pluginRss);
  // eleventyConfig.addPlugin(pluginSyntaxHighlight);
  eleventyConfig.addPlugin(pluginNavigation);

  // https://www.11ty.dev/docs/data-deep-merge/
  eleventyConfig.setDataDeepMerge(true);

  eleventyConfig.addFilter("cssmin", function(code) {
    return new CleanCSS({}).minify(code).styles;
  });

  eleventyConfig.addShortcode("today", () => `${new Date().toJSON().split('T')[0]}`)

  eleventyConfig.addFilter("readableDate", (dateObj, hideCurrentYear= true, tzOffset = -8) => {
    if (!dateObj) return '';

    let srcDate = new Date(dateObj);
    if (!srcDate) return ''; // unparseable
    // special case where we only had a date object (2021-01-01) where we don't want to timezone shift
    if (!/00:00:00.000Z/.test(srcDate.toJSON())) {
      srcDate = new Date(srcDate.getTime() + (tzOffset||0)*60*60*1000);
    }

    const d = srcDate.toJSON().split('T')[0];
    const today = new Date(Date.now() + (tzOffset||0)*60*60*1000).toJSON().split('T')[0];
    const yesterday = new Date(Date.now() - 24*60*60*1000 + (tzOffset||0)*60*60*1000).toJSON().split('T')[0];

    if (today === d) return 'Today';
    if (yesterday === d) return 'Yesterday';

    const [year, month, day] = d.split('-');
    if (hideCurrentYear && today.startsWith(year)) return `${ISO_3_LETTER_MONTH[Number.parseInt(month) - 1]}-${day}`;

    return `${year}-${ISO_3_LETTER_MONTH[Number.parseInt(month) - 1]}-${day}`;
  });

  eleventyConfig.addFilter("readableTime", (dateObj, tzOffset = -8) => {
    if (!dateObj) return '';
    const srcDate = new Date(dateObj);
    if (!srcDate) return ''; // unparseable

    const adjDate = new Date(srcDate.getTime() + (tzOffset||0)*60*60*1000);

    return adjDate.toLocaleTimeString().replace(/(\d+:\d+):\d\d|\.| /g, '$1');
  });

  // https://html.spec.whatwg.org/multipage/common-microsyntaxes.html#valid-date-string
  // eleventyConfig.addFilter('htmlDateString', (dateObj) => {
  //   return DateTime.fromJSDate(dateObj, {zone: 'utc'}).toFormat('yyyy-LL-dd');
  // });

  // Get the first `n` elements of a collection.
  eleventyConfig.addFilter("format", value => {
    if (Number.parseFloat(value)) {
      const formatter = new Intl.NumberFormat('en-CA');
      return formatter.format(value);
    }
    return value;
  });

  eleventyConfig.addFilter("formatNumber", (value, useSI=true, max=999999) => {
    if (Number.parseFloat(value)) {
      if (!max) max = Number.MAX_VALUE;
      const SI_SUFFIX = ["", "k", "M", "G"];
      const WORD_SUFFIX = ["", " thousand", " million", " billion", " trillion"];
      const formatter = new Intl.NumberFormat('en-CA');

      const divisor = Math.floor(Math.log10(Math.min(Math.abs(value), max)) / 3);
      if (divisor < 0) return formatter.format(Math.round(value*10)/10);
      const sigDig = value > max ? 0 : 2 - Math.floor(Math.log10(Math.abs(value))) % 3;
      const simpleValue = formatter.format(Math.round(Math.round(value / Math.pow(10, divisor * 3 - sigDig)) / Math.pow(10, sigDig) * 10)/10);
      const suffix = useSI ? SI_SUFFIX[divisor] : WORD_SUFFIX[divisor];
      return `${simpleValue}${suffix}`;
    }
    return value || '';
  });

  eleventyConfig.addFilter("head", (array, n) => {
    if( n < 0 ) {
      return array.slice(n);
    }

    return array.slice(0, n);
  });

  // Return the smallest number argument
  eleventyConfig.addFilter("min", (...numbers) => {
    return Math.min.apply(null, numbers.map(n => n || 0));
  });
  // Return the smallest number argument
  eleventyConfig.addFilter("max", (...numbers) => {
    return Math.max.apply(null, numbers.map(n => n || 0));
  });

  eleventyConfig.addFilter("filterProp", (valArray, property, compare, value) => {
    if (compare === "neq") {
      return valArray?.filter(v => v[property] !== value);
    }
    return valArray?.filter(v => v[property] === value);
  })

  // eleventyConfig.addFilter("filterTagList", tags => {
  //   // should match the list in tags.njk
  //   return (tags || []).filter(tag => ["all", "nav", "post", "posts"].indexOf(tag) === -1);
  // })

  // Create an array of all tags
  // eleventyConfig.addCollection("tagList", function(collection) {
  //   let tagSet = new Set();
  //   collection.getAll().forEach(item => {
  //     (item.data.tags || []).forEach(tag => tagSet.add(tag));
  //   });
  //
  //   return [...tagSet];
  // });

  eleventyConfig.addTransform("htmlmin", async function(content, outputPath) {
    if( outputPath && outputPath.endsWith(".html") ) {
      // const {html} = await posthtml().use(uglify()).process(content);
      // return htmlmin.minify(html, {
      return htmlmin.minify(content, {
        useShortDoctype: true,
        removeComments: true,
        collapseWhitespace: true
      });
    }

    return content;
  });

  // Copy the `img` and `css` folders to the output
  eleventyConfig.addPassthroughCopy("img");
  eleventyConfig.addPassthroughCopy("css");
  eleventyConfig.addPassthroughCopy({'_data/covid19tracker.ca': '/'});
  eleventyConfig.addPassthroughCopy({'_data/canada.ca': '/'});

  // Customize Markdown library and settings:
  // let markdownLibrary = markdownIt({
  //   html: true,
  //   breaks: true,
  //   linkify: true
  // }).use(markdownItAnchor, {
  //   permalink: true,
  //   permalinkClass: "direct-link",
  //   permalinkSymbol: "#"
  // });
  // eleventyConfig.setLibrary("md", markdownLibrary);

  // Override Browsersync defaults (used only with --serve)
  eleventyConfig.setBrowserSyncConfig({
    callbacks: {
      ready: function(err, browserSync) {
        const content_404 = fs.readFileSync('_site/404.html');

        browserSync.addMiddleware("*", (req, res) => {
          // Provides the 404 content without redirect.
          res.writeHead(404, {"Content-Type": "text/html; charset=UTF-8"});
          res.write(content_404);
          res.end();
        });
      },
    },
    ui: false,
    ghostMode: false
  });

  return {
    // Control which files Eleventy will process
    // e.g.: *.md, *.njk, *.html, *.liquid
    templateFormats: [
      "md",
      "njk",
      "html",
      "liquid"
    ],

    // -----------------------------------------------------------------
    // If your site deploys to a subdirectory, change `pathPrefix`.
    // Don’t worry about leading and trailing slashes, we normalize these.

    // If you don’t have a subdirectory, use "" or "/" (they do the same thing)
    // This is only used for link URLs (it does not affect your file structure)
    // Best paired with the `url` filter: https://www.11ty.dev/docs/filters/url/

    // You can also pass this in on the command line using `--pathprefix`

    // Optional (default is shown)
    pathPrefix: "/",
    // -----------------------------------------------------------------

    // Pre-process *.md files with: (default: `liquid`)
    markdownTemplateEngine: "njk",

    // Pre-process *.html files with: (default: `liquid`)
    htmlTemplateEngine: "njk",

    // Opt-out of pre-processing global data JSON files: (default: `liquid`)
    dataTemplateEngine: false,

    // These are all optional (defaults are shown):
    dir: {
      input: ".",
      includes: "_includes",
      data: "_data",
      output: "_site"
    }
  };
};
