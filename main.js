/*jslint vars: true, plusplus: true, devel: true, nomen: true, regexp: true, indent: 4, maxerr: 50 */
/*global define, $, brackets, window */

/** Simple extension that adds a "File > Hello World" menu item */
define(function (require, exports, module) {
  "use strict";

  var AppInit               = brackets.getModule("utils/AppInit"),
      EditorManager         = brackets.getModule("editor/EditorManager"),
      CodeHintManager       = brackets.getModule("editor/CodeHintManager"),
      DocumentManager       = brackets.getModule("document/DocumentManager"),
      ProjectManager        = brackets.getModule("project/ProjectManager"),
      ExtensionUtils        = brackets.getModule('utils/ExtensionUtils'),
      phpParser             = require('php-parser/dist/php-parser')
      ;

  ExtensionUtils.loadStyleSheet(module, 'styles/fontawesome.css');
  ExtensionUtils.loadStyleSheet(module, 'styles/thizer-phpcompletion.css');
  
  /**
   * The object
   */
  function PhpCompletion() {
    this.phpFiles = []
    this.hints = []

    this.editor
    this.cursor
    this.whatIsIt
    this.search

    this.loadFiles()
  }

  /**
   * Method called by constructor
   * 
   * @return {[void]} [Nothing is returned here]
   */
  PhpCompletion.prototype.loadFiles = function() {
    var $this = this

    var manager = ProjectManager.getAllFiles(function(file,index,result) {
      var ext = file.name.replace(/.+\./, '')
      if (ext === 'php') {
        $this.phpFiles.push(file)
      }
    })

    manager.done(function(allFiles) {
      console.log('All files loaded')
    })
  }

  PhpCompletion.prototype.getDocParsed = function(doc) {
    var content = doc
    try {
      if (typeof doc === 'object') {

        // Here we need to identify if file is parseable

        content = doc.getText()
      }

      // initialize a new parser instance
      var parser = new phpParser({ parser: { extractDoc: true, php7: true }, ast: { withPositions: true } });
      var docParsed = parser.parseCode(content)
    } catch (e) {
      console.log('Error parsing file, probally it is not saved yet')
      console.log(e)
    }
    return docParsed
  }
  
  PhpCompletion.prototype.extractClassObjs = function(doc, visibility) {
    var $this = this
    var hints = []

    var docParsed = $this.getDocParsed(doc)
    var bodyArray = $this.getBodyArray(docParsed)
    
//    console.log(bodyArray)
    
    for (var i in bodyArray) {
      var hintname = bodyArray[i].name
      
      // console.log([hintname, this.search, hintname.indexOf(this.search)])

      // If the hint doesnt match the search
      if ((this.search !== '') && (hintname.indexOf(this.search) === -1)) {
        continue
      }

      var hint = $('<span>').attr({
        "id": "thizer-"+hintname,
        "class": "thizer-hint",
        "data-hintname": hintname
      })
      
      /**
       * Comments
       */
      if (undefined !== bodyArray[i].leadingComments) {
        var commentSpan = $("<span>").attr({
          "class": "thizer-comment",
          "style": "display: none;"
        })
        
        for (var c in bodyArray[i].leadingComments) {
          var com = bodyArray[i].leadingComments[c]
          commentSpan.html(com.value.replace(/\n/g, '<br/>'))
//          console.log(com.value.split('\n'))
        }
        
        hint.append(commentSpan)
      }
      
      /** Hint itself **/
      var def = $('<span>').attr({
        'class': 'thizer-hint-def'
      })
      switch (bodyArray[i].visibility) {
        case 'public':
          def.append('<i class="fa fa-globe-americas thizer-text-success"></i> ')
          break;
        case 'protected':
          def.append('<i class="fa fa-map-marker-alt thizer-text-warning"></i> ')
          break;
        case 'private':
          def.append('<i class="fa fa-lock thizer-text-danger"></i> ')
          break;
      }
      
      if (bodyArray[i].kind === 'method') {
        var args = ''
        for (var a in bodyArray[i].arguments) {
          args += ', $'+bodyArray[i].arguments[a].name
        }
        hintname += '('+(args.replace(', ', ''))+')'
        
      } else if (bodyArray[i].kind === 'classconstant') {
        hintname += ' = '+bodyArray[i].value.raw
      }
      def.append(hintname)
      hint.append(def)
      
      // Add to the return
      hints.push(hint)
    }
    return hints
  }
  
  PhpCompletion.prototype.getBodyArray = function(docParsed, visibity) {
    var $this = this
    var bodyArray = []
    
    if (undefined === visibity) {
      visibity = 'public|protected|private'
    }
    
    if ((undefined !== docParsed) && (!docParsed.errors.length)) {
      for (var i in docParsed.children) {
        var item = docParsed.children[i]
        
        switch (item.kind) {
          case 'class':
            
            // Check for visibility
            for (var b in item.body) {
              var prop = item.body[b]
              if (visibity.indexOf(prop.visibility) !== -1) {
                bodyArray.push(prop)
              }
            }
            break
            
          case 'namespace':
            for (var c in item.children) {
              if (item.children[c].kind === 'class') {
                
                // Check for visibility
                for (var b in item.children[c].body) {
                  var prop = item.children[c].body[b]
                  if (visibity.indexOf(prop.visibility) !== -1) {
                    bodyArray.push(prop)
                  }
                }
                
                // Class parent
                if (item.children[c].extends) {
                  var parentName = item.children[c].extends.name
                  
                  for (var f in $this.phpFiles) {
                    if ($this.phpFiles[f].name.indexOf(parentName) !== -1) {
                      
                      var wait=true
                      
                      console.log('passo1')
                      $this.phpFiles[f].read(function(err, data, encoding, stat) {
                        console.log('passo2')
                        if (err) return;
                        bodyArray = bodyArray.concat($this.getBodyArray($this.getDocParsed(data), 'public|protected'))
                        wait = false
                      })
                      console.log('passo3')
                      
//                      while(wait) { }
                    }
                  }
                }
                
              }
            }
            break
        }
      } // End of multiple elements on the file
    } // End if errors
    
    // Return a list of accessible properties from the file
    return bodyArray
  }

  /**
   * Method called by HintProvider
   * 
   * @param  {[Editor]}  editor       [The Editor object]
   * @param  {[char]}  implicitChar [Last typed char by user]
   * @return {Boolean}              [If there's hints to the current mouse position]
   */
  PhpCompletion.prototype.hasHints = function (editor, implicitChar) {

    // Reset result set
    this.hints = []

    // Document is not able to be edited
    if (!editor.document.editable) {
      return false
    }

    // Get needle information
    this.editor = editor
    this.cursor = editor.getCursorPos()
    var curCharPos = this.cursor.ch
    var curLinePos = this.cursor.line
    var lineStr = editor._codeMirror.getLine(curLinePos)
    var totalLines = editor._codeMirror.doc.size

    this.whatIsIt = lineStr.substr(0, curCharPos).replace(/.+(\s|\(|\,|\.)/, '')
    this.search = lineStr.substr(0, curCharPos).replace(/.+(\s|\(|\,|\.)/, '')
    
    // Get Variables
    if (this.whatIsIt.indexOf('$') !== -1) {
      this.whatIsIt = '$'+(this.whatIsIt.replace(/(.+)?\$/gi, ''))
    }

    /**
     * Depending on the type of element we'll get
     * hints to complete the code
     */
    
    if (this.whatIsIt.indexOf('$this') !== -1) {
      
      // Redefine the search term and look for it into classes
      this.search = this.search.replace(/\$this(-\>)?/, '')
      var classHints = this.extractClassObjs(editor.document)
      
      for (var i in classHints) {
        this.hints.push(classHints[i])
      }

    } else if ((this.whatIsIt[0] === '$') && (this.whatIsIt.indexOf('>') !== -1)) {

      console.log('A class instance object')

    } else if (this.whatIsIt[0] === '$') {

      console.log('A local variable')

    } else if (lineStr.indexOf('new '+this.whatIsIt)) {

      console.log('New Instance')

    } else {

      console.log('Can be anything')

    }

    // var token = TokenUtils.getInitialContext(editor._codeMirror, editor.getCursorPos());
    
    return (this.hints.length !== 0)
  }

  /**
   * Return the hints list
   * 
   * @param  {[char]} implicitChar [Last char typed by the user]
   * @return {[Object]}              The hints list
   */
  PhpCompletion.prototype.getHints = function (implicitChar)
  {
    return {
      hints: this.hints,
      match: this.search,
      selectInitial: true,
      handleWideResults: true
    }
  }
  
  PhpCompletion.prototype.insertHint = function(hint) {
    // var cursor = this.editor.getCursorPos();
    // var lineBeginning = {line:cursor.line,ch:0};
    // var textBeforeCursor = this.editor.document.getRange(lineBeginning, cursor);
    // var indexOfTheSymbol = textBeforeCursor.search(this.currentTokenDefinition);
    // var replaceStart = {line:cursor.line,ch:indexOfTheSymbol};
    // this.editor.document.replaceRange(hint, replaceStart, cursor);
    
    console.log(hint)
    
    return false
  }

  /**
   * When app is ready to begin
   * @param  {PhpCompletion} ) {               var phpCompletion [description]
   * @return {[type]}          [description]
   */
  AppInit.appReady(function () {

    var phpCompletion = new PhpCompletion()

    // register the provider.  Priority = 10 to be the provider of choice for php
    CodeHintManager.registerHintProvider(phpCompletion, ["php"], 10);

  })

});
