module.exports = function(eleventyConfig) {
  // Copy static assets from webroot (they'll be preserved in output)
  // Note: Static assets in webroot will be preserved during build
  // We copy style directory to output
  eleventyConfig.addPassthroughCopy("style");

  return {
    dir: {
      input: "src",
      output: "webroot",
      includes: "_includes",
      layouts: "_layouts"
    },
    templateFormats: ["html", "md", "njk"],
    htmlTemplateEngine: "njk",
    markdownTemplateEngine: "njk"
  };
};
