/* Define one global function that renders markdown.
 TODO: require.js module.
*/
(function() {
  var md = new MarkdownDeep.Markdown();
  md.ExtraMode = true;
  md.SafeMode = false;

  window.md_to_html = function( text ) {
    return md.Transform( text );
  };
})();
