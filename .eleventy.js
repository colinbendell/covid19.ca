const { DateTime } = require("luxon");
const fs = require("fs");
const CleanCSS = require("clean-css");
const pluginNavigation = require("@11ty/eleventy-navigation");

const formatter = new Intl.NumberFormat('en-CA');
function format(value) {
  const formattedValue = formatter.format(value);
  // this safely returns any values that aren't numbers, such a 'N/A'
  if (formattedValue === 'NaN') return value;
  // otherwise return the number as a string with commas in it
  return formattedValue;
}

function formatNumber(value) {
  if (Number.parseInt(value) > 1000) {
    if (value < 100*1000) {
      return format(Math.round(value/100)/10) + "k";
    }
    return format(Math.round(value/1000)) + "k";
  }
  if (Number.isFinite(value)) return value; //ensures that "0" properly returns
  return value || '';
}

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

  eleventyConfig.addFilter("readableDate", dateObj => {
    if (!dateObj) return '';

    const d = DateTime.fromJSDate(new Date(dateObj));
    const today = DateTime.now();
    const yesterday = DateTime.fromJSDate(new Date(Date.now() - 24*60*60*1000));

    if (today.toFormat('yyyy-LL-dd') === d.toFormat('yyyy-LL-dd')) return 'Today';
    if (yesterday.toFormat('yyyy-LL-dd') === d.toFormat('yyyy-LL-dd')) return 'Yesterday';

    return d.year === today.year ? d.toFormat("LLL dd") : d.toFormat("yyyy LLL dd");
  });

  // https://html.spec.whatwg.org/multipage/common-microsyntaxes.html#valid-date-string
  // eleventyConfig.addFilter('htmlDateString', (dateObj) => {
  //   return DateTime.fromJSDate(dateObj, {zone: 'utc'}).toFormat('yyyy-LL-dd');
  // });

  // Get the first `n` elements of a collection.
  eleventyConfig.addFilter("format", value => format(value));
  eleventyConfig.addFilter("formatNumber", value => formatNumber(value));

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

  // Copy the `img` and `css` folders to the output
  eleventyConfig.addPassthroughCopy("img");
  eleventyConfig.addPassthroughCopy("css");

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
