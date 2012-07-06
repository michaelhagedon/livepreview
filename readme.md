[gh-pages](http://bootstraponline.github.com/livepreview_o2/public)

# ok
emcc -O2 --minify 0 -s ASSERTIONS=1 sundown.bc -o sundown_o2_m0_a1.js

# failure
emcc -O2 -s ASSERTIONS=1 sundown.bc -o sundown_o2_a1.js
