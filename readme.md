- [sundown + livepreview](http://bootstraponline.github.com/livepreview/public/web)
- [markdowndeep + livepreview](http://bootstraponline.github.com/livepreview/public/web/index_deep.html)

Uses code/assets from:

0. [ace](https://github.com/ajaxorg/ace)
0. [gollum](https://github.com/github/gollum)
0. [jquery](https://github.com/jquery/jquery)
0. [sizzle](https://github.com/jquery/sizzle)
0. [notepages](https://github.com/fivesixty/notepages)
0. [retina_display_icon_set](http://blog.twg.ca/2010/11/retina-display-icon-set/)
0. [debounce](https://github.com/cowboy/jquery-throttle-debounce)
0. [requirejs](https://github.com/jrburke/requirejs)
0. [emscripten](https://github.com/kripken/emscripten)
0. [sundown](https://github.com/bootstraponline/sundown)
0. [markdowndeep](https://github.com/toptensoftware/markdowndeep)

See licenses folder for details.

# Updating gollum

- /public/web/* - livepreview files

The folders below are from gollum.

- /public/css - gollum css
- /public/javascript - gollum javascript
- /public/images - gollum images


# Dependency Notes

## Ace
Using master branch at [49a120990f9938bf5b7bcb0c619a866db271fc6c](https://github.com/ajaxorg/ace/commit/49a120990f9938bf5b7bcb0c619a866db271fc6c).

- Copy `ace-builds/src-min` to `/public/js/ace/src-min`

Build ACE [manually](https://github.com/ajaxorg/ace/wiki/Building-ace).

`node Makefile.dryice.js minimal-min --target ../ace-builds`

All changes to Ace for livepreview have been upstreamed.
- Gutter control [#799](https://github.com/ajaxorg/ace/pull/799)
- GitHub theme [#798](https://github.com/ajaxorg/ace/pull/798)

## jQuery & Sizzle
Using jQuery v1.7.2.

- Download latest production version from [jquery.com](http://www.jquery.com).
