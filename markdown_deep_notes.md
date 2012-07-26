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

--

Upstream markdowndeep is not maintained. This fork aims for feature parity with [Sundown](https://github.com/tanoku/sundown). I'm only using the JavaScript version of markdowndeep so changes to the .NET version have not been made.

- @EisenbergEffect [fix](https://github.com/shiftkey/markdowndeep/commit/93985bd51d2a749ea742ebf5c2f7397e579e1047) for [#14](https://github.com/toptensoftware/markdowndeep/pull/14)
- @5arx [fix 1](https://github.com/5arx/markdowndeep/commit/bbce4a4ba284e7113cb41ae772dcd77b0ec4e4a9) and [2](https://github.com/5arx/markdowndeep/commit/a29dae192855fc8dc13f7a008f7fae2d46d9d2ba) for [#11](https://github.com/toptensoftware/markdowndeep/pull/11)

- My [fix](https://github.com/bootstraponline/livepreview/commit/28ddc73f4f16855aa0b954bb6860bf3b651e40b6#L1L294) for [#8](https://github.com/toptensoftware/markdowndeep/issues/8)
- Support for line separator. `--` is converted to an empty h2.
- Fix list continuation [#16](https://github.com/toptensoftware/markdowndeep/issues/16).
