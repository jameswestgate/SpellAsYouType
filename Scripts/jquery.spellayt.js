/*
* Spell As You Type jQuery Plugin v1.3
*
* Copyright (c) 2009 Honda UK (www.honda.co.uk)
* @author James Westgate
* @requires jQuery v1.3.2 or later
*
* Dual licensed under the MIT and GPL licenses:
*   http://www.opensource.org/licenses/mit-license.php
*   http://www.gnu.org/licenses/gpl.html
*
* Dictionary.txt based on the English wordlist created by Kevin Atkinson
* licensed under the LGPL license.
*
*/

//Create closure
(function($) {

    //Global values
    var _dic = new Array(26),       //Dictionary, parsed into array by 1st letter, length
        _words = [],                //Hold a list of words that have been queued to become suggestions
        _suggests = {},             //List of words that have been checked
        _ready = false,             //dictionary ready flag
        _loading = false,           //dictionary load in progress
        _changed = false,           //text has changed since last word break
        _opts = null,               //options passed into the plugin
        _wordQ = [],                //word breaking queue
        _wordT = 0,                 //word breaking queue timer
        _highT = 0,                 //highlight timer
        _breakT = 0,                //restart word breaking timer
        _current = null,            //input with focus
        _suggestQ = [],             //suggestion finding queue
        _suggestT = 0;              //suggestion queue timer

    var $win = $(window);

    //Plugin definition
    $.fn.extend({

        spellayt: function(options) {

            //This plugin is only required for IE 6.0+ users.
            if (!$.browser.msie) return;
            if ($.browser.version < 6) return;

            //Combine options passed with our defaults
            _opts = $.extend({}, $.fn.spellayt.defaults, options);

            //Load the dictionary from a url
            if (!_ready && !_loading) {

                _loading = true;

                //console.log('Loading dictionary...');

                $.ajax({
                    type: "GET",
                    url: _opts.url,
                    dataType: "text",
                    success: function(data) {

                        //Load the dictionary into the dictionary array. It is best to cache this on the client.
                        //console.log('Parsing dictionary ...');
                        loadDic(data);
                        _ready = true;
                        if ($.fn.spellayt.loaded != null) $.fn.spellayt.loaded();
                        _loading = false;

                        // console.log('Dictionary parsed.');

                        //Start checking
                        startCheck();
                    },
                    error: function(XMLHttpRequest, textStatus, errorThrown) {
                        if ($.fn.spellayt.loadError != null) $.fn.spellayt.loadError(textStatus);
                        _loading = false;
                    }
                });
            }

            //Bind to the window scroll to remove highlights
            $win.scroll(function(event) {
                $('div.spellayt', this).remove();
            });

            //Bind to the window resize to remove highlights
            $win.bind('resize', function() {
                $('div.spellayt', this).remove();
            });

            //Insert a hidden div to fix any absolute position problems with underline divs
            $("<div style='position:absolute;top:0;left:-10;width:1;height:1'></div>").appendTo(document.body).show();

            //Loop through each item in the matched set and apply event handlers
            return this.each(function(i) {

                //Place a hidden span before and after the control for textRanges to work correctly
                var html = '<span style="display:none">.</span>';
                $(html).insertBefore(this);
                $(html).insertAfter(this); //Create new element each time

                var $this = $(this);

                //Set up local options
                $this.data('opts', _opts);

                //When the input gains focus, set it as the current input and start the timers
                $this.focus(function(event) {

                    _current = this;
                    if (_ready) startCheck();
                });

                //When the input looses focus, remove menu and highlight and cancel the timers
                $this.blur(function(event) {

                    if (_ready) stopCheck();
                    //_current = null; - menu selection causes blur
                });

                //Remove our context menu on mouse down
                $this.mousedown(function(event) {
                    $('div.spellaytMenu').remove();
                });

                //Bind to the input scroll to remove highlights
                $this.scroll(function(event) {
                    clear();
                });

                //Perform functions on key down
                $this.keydown(function(e) {

                    var code = e.keyCode;
                    if (code >= 33 && code <= 40) return; //arrows, page up page down, home end
                    if (code == 27 || code == 8 || code == 46 || code == 13) { //Escape, backspace, delete, enter
                        $('div.spellaytMenu').remove();
                        clear();
                        return;
                    }

                    clear();
                    highlight(_current); //Rehighlight
                    _changed = true;
                });

                //Bind to the browser contextmenu event
                $this.bind("contextmenu", function() {

                    //Show the normal context menu if suggestions are not shown
                    return !showSuggestions(this);
                });
            });
        },

        spellcheck: function(options) {

            //Clear once only
            clear();

            //Combine options passed with our defaults
            _opts = $.extend({}, $.fn.spellayt.defaults, options);

            return this.each(function(i) {

                if (!_ready) return;

                var $this = $(this);

                //Set up local options
                $this.data('opts', _opts);

                //Cancel any timers
                clearTimeout(_wordT);
                clearInterval(_highT);
                clearInterval(_breakT);

                //Fills the word queue with checkSentence functions,checkWord functions and lookupWord functions
                _changed = false;
                breakText(this);

                //Processes an item off the queue until empty
                while (_wordQ.length > 0) {
                    doQueueWork(_wordQ, _wordT, 0);
                }

                //Highlight the misspellt words
                highlight(this);
            });
        },

        spellclear: function(options) {

            return this.each(function(i) {
                clear();
            });
        }
    });

    //plugin defaults - added as a property on our plugin function
    $.fn.spellayt.defaults = {
        url: "dictionary.txt",          //Default url of dictionary
        matchSentence: /[^.!?]+/g,      //Regex to split text into sentences
        matchWord: /[a-zA-Z0-9_]+/g,    //Regex to split sentences into words
        maximum: 12,                    //Maximum no of suggestions to display
        milliseconds: 50,               //No of milliseconds between work items in the work queue
        offset: { left: 0, top: -4 },   //Underline offset from bottom of text
        resources: { ignore: "Ignore All", nosuggest: "No Suggestions" }
    };

    //Callback when the dictionary is loaded
    $.fn.spellayt.loaded = null;

    //Callback when the dictionary load fails
    $.fn.spellayt.loadError = null;

    //Returns the ready status
    $.fn.spellayt.ready = function() {
        return _ready;
    };

    //Replace the word under the caret with the word provided
    $.fn.spellayt.replace = function(value) {
        var caret = getCurrentWord();

        if (caret != null) {

            //Use the text range to replace the word
            //by default the range expand method includes a space delimiter when a space has been used
            if (caret.text.indexOf(" ") != -1) value += ' ';
            caret.text = value;

            //Refocus and highlight as we've lost focus during the click
            refocus();

            return true;
        }

        return false;
    };

    //Ignores all instances of the word under the caret
    $.fn.spellayt.ignore = function() {
        var caret = getCurrentWord();

        if (caret != null) {

            //Get the word under the caret
            var word = $.trim(caret.text);

            //Find the suggestion for this word
            var suggest = _suggests[word];

            if (suggest != null) {
                suggest.ignore = true;

                //Refocus after clicking on the div
                refocus();
                return true;
            }
        }
        return false;
    };

    //Clear any onscreen artifacts for all matched elements
    var clear = function() {
        $('.spellayt').remove();
    };

    //Start spell checking
    var startCheck = function() {

        if (_current != null) {

            //Set a timer to break words every 1/2 second, if the word breaking queue is empty
            _breakT = setInterval(function() { if (_wordQ.length == 0) breakText(_current); }, 500);

            //Set a timer to highlight words every 1/2 second
            _highT = setInterval(function() { clear(); highlight(_current); }, 500);

            //Start the the word breaking queue
            doQueueWork(_wordQ, _wordT, _opts.milliseconds);
        }
    };

    //Stop spell checking
    var stopCheck = function() {
        $('div.spellaytMenu').remove();
        $('.spellayt').remove();

        //Cancel timers
        clearTimeout(_wordT);
        clearInterval(_highT);
        clearInterval(_breakT);
    };

    //Highlight suggestions in the input provided
    var highlight = function(input) {
        if (input == null) return;

        //Loop through the suggestions and underline the misspellt words
        var wholerng = input.createTextRange();
        var wholeWordsOnly = 2;
        var $input = $(input);
        var data = $input.data('opts');

        //If the user has overwritten the data, then get the global options
        if (data == null) data = _opts;

        var totScroll = $win.scrollTop() + $input.scrollTop() + data.offset.top;
        var totScrollLeft = $win.scrollLeft() + $input.scrollLeft() + data.offset.left - 1;

        var pos = $input.offset();
        var right = pos.left + $input.width();
        var bottom = pos.top + $input.height(); //Gets bottom of the scrollable area

        var sb = [];

        for (var de in _suggests) {
            var suggest = _suggests[de];

            if (!suggest.match && !suggest.ignore) {
                var rng = wholerng.duplicate();

                while (rng.findText(suggest.term, 0, wholeWordsOnly)) {

                    //Place an absolute positioned div over the word with a squiggly line
                    var x = rng.boundingLeft + totScrollLeft;
                    var y = rng.boundingTop + rng.boundingHeight + totScroll;

                    //Stop highlighting if overflow
                    if (y > bottom) break;

                    //Highlight if scroll visible and word not currently being edited
                    if (y > pos.top && x >= pos.left && (x + rng.boundingWidth < right) && rng.compareEndPoints('EndToEnd', wholerng) != 0) {

                        //Build up html to add to the dom
                        sb.push("<div id='divWord' class='spellayt' style='top:");
                        sb.push(y);
                        sb.push("px;left:");
                        sb.push(x);
                        sb.push("px;width:");
                        sb.push(rng.boundingWidth);
                        sb.push("px'></div>");
                    }

                    //Move rng to end of word, then reexpand to end of text
                    rng.move("word"); //Move to end of the word found
                    rng.setEndPoint("EndToEnd", wholerng);
                }
            }
        }

        //Add to DOM
        if (sb.length > 0) {
            sb.unshift("<div style='position:absolute; z-index:96; left:0px; top: 0px'>");
            sb.push("</div>");
            $(sb.join('')).appendTo(document.body);
        }
    };

    //Breaks the text up so that it can be spell checked
    var breakText = function(input) {
        if (input == null) return;

        //Process all sentences if the text hasnt changed since last word break.
        if (!_changed) {

            //Get an array of sentences and put them on the work queue
            //console.log('Looking for new words...');
            var snts = splitSentences(input.value);
            if (snts == null) return;

            //Add the call to checkSentence() to the work queue for each word in each sentence
            for (var i = 0; i < snts.length; i++) {
                _wordQ.push({ c: function(parm) { checkSentence(parm); }, d: snts[i] });
            }
        }
        //Otherwise just process sentence under current cursor
        else {
            var sntn = document.selection.createRange();
            sntn.expand("sentence", -1);
            if (sntn == null) return;

            //console.log('Checking sentence (' + sntn.text + ') ...');
            _wordQ.push({ c: function(parm) { checkSentence(parm); }, d: sntn.text });
        }

        _changed = false;
    }

    //Load dictionary data into 3d array
    var loadDic = function(data) {

        //Initialise each of the 26 alpha arrays with 13 length arrays, containing arrays of words
        for (var i = 0; i < 26; i++) {
            _dic[i] = new Array(13);

            for (var i2 = 0; i2 < 13; i2++) {
                _dic[i][i2] = [];
            }
        }

        var pos = data.indexOf('\r\n');
        var lastpos = 0;

        //Load the arrays from the data retrieved
        while (pos > -1) {

            var word = data.substring(lastpos, pos);
            var chr = word.charCodeAt(0);
            var len = word.length;

            if (!isNaN(chr)) {

                //Words with length > 13 go into array 13
                if (len > 13) len = 13;

                //Convert to upper case and reduce to zero index
                if (chr > 96 && chr < 123) chr -= 32;
                chr -= 65;

                if (chr >= 0 && chr <= 25) _dic[chr][len - 1].push(word);
            }

            lastpos = pos + 2;
            pos = data.indexOf('\r\n', lastpos);
        }

        //Clear the data retrieved
        data = null;
    }

    //Processes an item on the queue and adds a callback to the next item
    var doQueueWork = function(queue, timer, ms) {

        //Get an item off the queue
        if (queue.length > 0) {
            var work = queue.shift();
            work.c(work.d);
        }

        //Process the next item leaving enough time so that script doesnt time out
        if (ms > 0) timer = setTimeout(function() { doQueueWork(queue, timer, ms); }, ms);
    }

    //Loop through the sentence provided and push each word onto the word breaking queue
    var checkSentence = function(sentence) {

        //Get the array of words making up the sentence
        if (sentence == null) return;

        //Break the sentence into words
        var words = sentence.match(_opts.matchWord);
        if (words == null) return

        //Loop through all words
        for (var i = 0; i < words.length; i++) {

            //Have to push duplicate words onto the queue, lookup here is too slow
            _wordQ.push({ c: function(parm) { checkWord(parm); }, d: words[i] });
        }
    }

    //Check that the word can be processed as a suggestion and place the suggestion onto the work queue
    var checkWord = function(word) {

        //Check if this word has already been processed
        if (_words[word] != null) return;
        _words[word] = true;

        //console.log('Adding word for checking "' + word + '"');

        var chr = getWordIndex(word);

        //Ignore words that dont start with an alpha
        if (chr < 0 || chr > 25) return;

        //Ignore all capitals eg acronyms
        if (word.toUpperCase() == word) return;

        //Set up new suggestion object
        var suggest = {
            term: word,
            index: chr,
            alts: null,
            match: false,
            ignore: false,
            ready: false
        };

        //Add the word to the queue for processing
        _wordQ.push({ c: function(parm) { lookupWord(parm); }, d: { suggest: suggest, word: word} });
    }

    //Looks up a word to see if it exists in the dictionary
    var lookupWord = function(data) {

        var suggest = data.suggest;
        var word = data.word;

        //console.log('Looking up word "' + word + '"');

        var length = word.length;
        if (length > 13) length = 13;

        suggest.match = (bSearch(word, _dic[suggest.index][length - 1]) > -1);

        //If there is not a match, try other combinations
        if (!suggest.match) {

            //Do another lookup if not matched
            var chr = word.charCodeAt(0);

            //If the first letter is a capital, make word lower case and put it back on the queue
            if (chr > 64 && chr < 91) {

                //Add lower case version back onto the queue
                _wordQ.push({ c: function(parm) { lookupWord(parm); }, d: { suggest: suggest, word: word.toLowerCase()} });
                return;
            }
        }

        //Add this suggestion to the list of suggestions. Make sure to use the original term.
        _suggests[suggest.term] = suggest;
    }

    //Processes a suggest object
    var getSuggestion = function(suggest, input) {

        //Set up an array for each alt
        suggest.alts = [];
        for (var i = 0; i <= 4; i++) suggest.alts[i] = [];

        var array = _dic[suggest.index];
        var word = suggest.term;
        var substr = word.substr(1);
        var len = word.length - 1;
        if (len > 12) len = 12;

        //If the length is two, check for a direct match with the words swapped and add as a suggestion
        if (len == 1) {
            var altword = (word.charAt(1) + word.charAt(0)).toLowerCase();
            var altarray = _dic[getWordIndex(altword)];
            if (bSearch(altword, altarray[1]) > -1) suggest.alts[0].push(altword);
        }

        //If length > 2 then check words starting with other letter of the alphabet as a direct match
        if (len > 1) {
            var chr = word.charCodeAt(0);
            var isProper = (chr >= 65 && chr <= 91);
            var idx = getWordIndex(word);

            //Loop through each letter 
            for (var i = 0; i < 26; i++) {

                //Only process other letters of the alphabet
                if (i != idx) {
                    var uc = String.fromCharCode(65 + i) + substr;
                    var lc = String.fromCharCode(97 + i) + substr;
                    var altword = (isProper) ? uc : lc;
                    var altarray = _dic[i];
                    if (bSearch(altword, altarray[len]) > -1) suggest.alts[1].push(altword); //ld is 1

                    var altword = (!isProper) ? uc : lc;
                    if (bSearch(altword, altarray[len]) > -1) suggest.alts[2].push(altword); //ld is now 2
                }
            }
        }

        //Push suggestion processing onto a queue to avoid script timeout errors
        _suggestQ.push({ c: function(parm) { getSuggests(parm); }, d: { word: word, array: array[len], suggest: suggest} });

        //Words of length plus one
        if (len < 12) _suggestQ.push({ c: function(parm) { getSuggests(parm); }, d: { word: word, array: array[len + 1], suggest: suggest} });

        //Words of length minus one
        if (len > 0) _suggestQ.push({ c: function(parm) { getSuggests(parm); }, d: { word: word, array: array[len - 1], suggest: suggest} });

        //Words of length plus two
        if (len < 11) _suggestQ.push({ c: function(parm) { getSuggests(parm); }, d: { word: word, array: array[len + 2], suggest: suggest} });

        _suggestQ.push({ c: function(parm) { completeSuggestion(parm); }, d: { suggest: suggest, input: input} });

        //Start the suggestion queue by calling the first item
        doQueueWork(_suggestQ, _suggestT, 5);
    }

    //Loop through words in each length array populating a suggest object.
    //Use the Levenshtein distance algorithm to determine how similar words are 
    //Keep words with lev distances of 3 or lower
    var getSuggests = function(parms) {

        var word = parms.word;
        var array = parms.array;
        var suggest = parms.suggest;

        //Loop through the array of words and get more suggestions
        for (var i = 0; i < array.length; i++) {

            var dicword = array[i];
            var ld = levDist(word, dicword);

            //Matches on modified words may produce a direct match
            if (ld == 0) {
                suggest.alts[0].push(dicword);
            }
            else {
                //Push items depending on their length compared to their ld
                var f = Math.floor(word.length / 2);
                if (f <= 0) f = 1;
                if (f > 4) f = 4;
                if (f >= ld) suggest.alts[ld].push(dicword);
            }
        }
    }

    //Helper queue function to set a suggestion as ready
    var completeSuggestion = function(parms) {
        parms.suggest.ready = true;
        clearTimeout(_suggestT);

        //Recall the function to show the suggestions
        showSuggestions(parms.input)
    }

    //Shows the suggestions for an input
    var showSuggestions = function(input) {
        var caret = getCurrentWord();

        if (caret != null) {

            var rng = document.selection.createRange();
            var x = rng.boundingLeft + $win.scrollLeft() + $(input).scrollLeft();
            var y = rng.boundingTop + (rng.boundingHeight / 2) + $win.scrollTop() + $(input).scrollTop();

            //Place an absolute positioned div over the word to look like a menu
            var style = "top:" + y + "px;left:" + x + "px;height:auto";

            //Get the word under the caret
            var word = $.trim(caret.text);

            //Find the suggestion for this word
            var suggest = _suggests[word];

            if (suggest != null && !suggest.match && !suggest.ignore) {

                var chr = word.charCodeAt(0);
                var isProper = (chr >= 65 && chr <= 91);

                //Cancel timers
                clearTimeout(_wordT);
                clearInterval(_highT);
                clearInterval(_breakT);

                //Lookup suggestions if required
                if (!suggest.ready) {
                    getSuggestion(suggest, input);
                    return true; //this function will be recalled once suggestions are loaded
                }

                //Append the div to the document body
                var menuHtml = "<div id='divSuggest' class='spellaytMenu' style='" + style + "'></div>";
                var $mnu = $(menuHtml).appendTo(document.body);

                var count = 0;
                for (var i = 0; i < suggest.alts.length; i++) {

                    //Check if we have hit the maximum, otherwise ignore the options
                    if (i < 2 || count + suggest.alts[i].length <= _opts.maximum) {

                        for (var i2 = 0; i2 < suggest.alts[i].length; i2++) {

                            var sel = suggest.alts[i][i2].replace("'", "&#39;");

                            //Convert to upper if originally in upper
                            if (isProper) sel = sel.charAt(0).toUpperCase() + sel.substr(1);

                            $mnu.append("<a class='spellaytMenuItem' href='#' onmousedown='jQuery.fn.spellayt.replace(\"" + sel + "\");return false;'>" + sel + "</a>");
                            count++;
                        }
                    }
                }

                if (count == 0) $mnu.append("<a class='spellaytMenuItem' href='#' onmousedown='jQuery.fn.spellayt.ignore();return false;'>(" + _opts.resources.nosuggest + ")</a>");

                //Seperator line and Ignore
                $mnu.append("<div class='spellaytMenuSep'><span style='height:1px'/></div>");
                $mnu.append("<a class='spellaytMenuItem' href='#' onmousedown='jQuery.fn.spellayt.ignore();return false;'>" + _opts.resources.ignore + "</a>");

                //If using IE6, then place an iframe underneath the menu to avoid the select zorder problem
                // Updated to use the bgiframe plug-in, if present
                if ($.browser.version == 6 && $.fn.bgiframe) $mnu.bgiframe();

                $mnu.show();

                return true;
            }
        }
        return false;
    }

    //Returns an array of sentences
    var splitSentences = function(text) {

        //Split into sentences by using the supplied regex
        var sntcs = text.match(_opts.matchSentence); //Any character that delimits a sentence
        var result = [];

        if (sntcs == null) return;

        //Loop through each sentence and split into words
        for (var i = 0; i < sntcs.length; i++) {
            var sntc = sntcs[i];

            if (sntc != null) {
                sntc = $.trim(sntc);
                result.push(sntc);
            }
        }

        return result;
    }

    //Refocus to the current textbox and highlight in 100 ms.
    var refocus = function() {
        setTimeout(function() { _current.focus(); clear(); highlight(_current); }, 200);
    }

    //http://www.merriampark.com/ld.htm, http://www.mgilleland.com/ld/ldjavascript.htm, Damerau–Levenshtein distance (Wikipedia)
    var levDist = function(s, t) {
        var d = []; //2d matrix

        // Step 1
        var n = s.length;
        var m = t.length;

        if (n == 0) return m;
        if (m == 0) return n;

        //Create an array of arrays in javascript (a descending loop is quicker)
        for (var i = n; i >= 0; i--) d[i] = [];

        // Step 2
        for (var i = n; i >= 0; i--) d[i][0] = i;
        for (var j = m; j >= 0; j--) d[0][j] = j;

        // Step 3
        for (var i = 1; i <= n; i++) {
            var s_i = s.charAt(i - 1);

            // Step 4
            for (var j = 1; j <= m; j++) {

                //Check the jagged ld total so far
                if (i == j && d[i][j] > 4) return n;

                var t_j = t.charAt(j - 1);
                var cost = (s_i == t_j) ? 0 : 1; // Step 5

                //Calculate the minimum
                var mi = d[i - 1][j] + 1;
                var b = d[i][j - 1] + 1;
                var c = d[i - 1][j - 1] + cost;

                if (b < mi) mi = b;
                if (c < mi) mi = c;

                d[i][j] = mi; // Step 6

                //Damerau transposition
                if (i > 1 && j > 1 && s_i == t.charAt(j - 2) && s.charAt(i - 2) == t_j) {
                    d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + cost);
                }
            }
        }

        // Step 7
        return d[n][m];
    }

    var getWordIndex = function(word) {
        var chr = word.charCodeAt(0);

        //Work out the main array based on the first char
        //Convert to upper case and reduce to zero
        if (chr > 96 && chr < 123) chr -= 32;
        chr -= 65;

        return chr;
    }

    //Expands a selection to encompass the word
    var getCurrentWord = function() {
        var rng = document.selection.createRange();
        rng.expand("word");

        //May be last word in sentence
        if (rng.text == '.') {

            rng = document.selection.createRange();
            rng.moveStart("word", -1);
            rng.moveEnd("sentence");
            rng.moveEnd("character", -2);
        }

        return rng;
    }

    //value, array
    var bSearch = function(v, a) {

        var l = 0;
        var r = a.length - 1;

        while (l <= r) {

            var mid = parseInt((l + r) / 2, 10);
            var m = a[mid];
            if (m === v)
                return mid;
            else if (m < v)
                l = mid + 1;
            else
                r = mid - 1;
        }

        //when element is not found 
        return -1;
    }

    // end of closure
})(jQuery);
