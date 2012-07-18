Test md deep:

```
var md = new MarkdownDeep.Markdown();
md.ExtraMode = true;
md.SafeMode = false;
var text = md.Transform( $.editorSession.getValue() );
document.getElementById( 'contentframe' ).innerHTML = text;
```

Open:
- no support for autodetecting email addresses
<a href="mailto:tom@github.com">tom@github.com</a>

- no support for autodetecting links
<a href="http://www.france.com">http://www.france.com</a>


Fixed:
- no support for link references
[Google][1]
[1]: http://google.com/        "Google"


- no support for '--' line separator
<h2></h2>

- property names in links are broken
[length]
https://github.com/toptensoftware/markdowndeep/issues/8

- merged upstream pull requests into the JavaScript version


gfm fenced code blocks do not work.

```ruby
# ruby
puts 'code highlighting'

puts "!"
```


list continuation problems

- 1
- 2
- 3

0. a
0. b
0. c
