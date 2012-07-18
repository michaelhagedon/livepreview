// Define one global function that renders markdown.
(function() {
  var md = new MarkdownDeep.Markdown();
  md.ExtraMode = true;
  md.SafeMode = false;

  window.md_to_html = function( text ) {
    return md.Transform( text );
  };
})();
