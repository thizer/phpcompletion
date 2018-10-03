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
    this.insertHintOnTab = true

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
        file.read(function(err, data) {
          if (err) throw new err
        })

        $this.phpFiles.push(file)
      }
    })

    manager.done(function(allFiles) {
      console.log('We loaded all the '+$this.phpFiles.length+' PHP files found')
    })
  }

  PhpCompletion.prototype.getDocParsed = function(doc) {
    var content = doc
    try {

      // initialize a new parser instance
      var parser = new phpParser({ parser: { extractDoc: true, php7: true }, ast: { withPositions: true } });

      // Try to get content from text
      if (typeof doc === 'object') {

        // Is not saved yet
        if (doc.isDirty) {
          content = doc.file._contents
        } else {
          content = doc.getText()
        }
      }
      
      var docParsed = parser.parseCode(content)
    } catch (e) {
      // console.log('Error parsing file, probally it is not saved yet')
      // console.log(e)
    }
    return docParsed
  }
  
  /**
   * Extract from a class document all content and turns it to hints
   * 
   * @param  {[type]} doc        [description]
   * @param  {[type]} visibility [description]
   * @return {[type]}            [description]
   */
  PhpCompletion.prototype.extractClassObjs = function(doc, visibility) {
    var $this = this
    var hints = []

    var docParsed = $this.getDocParsed(doc)
    var bodyArray = $this.getBodyArray(docParsed)
    
    for (var i in bodyArray) {
      var hintname = bodyArray[i].name
      
      // console.log([hintname.toLowerCase(), this.search, hintname.toLowerCase().indexOf(this.search)])

      // If the hint doesnt match the search
      if ((this.search !== '') && (hintname.toLowerCase().indexOf(this.search) === -1)) {
        continue;
      }

      var hint = $('<span>').attr({
        "id": "thizer-"+hintname.toLowerCase(),
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
          var com = bodyArray[i].leadingComments[c].value.split('\n')

          var commentText = ""
          var commentAnn = ""
          for (var cL in com) {
            var comLine = com[cL].replace(/^[/*\s]+/gi, '').trim()
            if (comLine === '') {
              continue
            }
            if (comLine.indexOf('@return') !== -1) {
              commentAnn = "<br/>&nbsp;&nbsp;* <b>"+comLine+"</b>"
            } else if (commentText === '') {
              commentText = "/** "+comLine+" [more...]"
            }
          }

          /** Comments must to be small (2 lines only) */
          commentSpan.html(commentText+commentAnn+" */")
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

        /**
         * Must update $('.thizer-hint').data('hintname')
         */
        hint.data('hintname', hintname)
        
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
  
  /**
   * An array with all document (file) class contents
   * 
   * @param  {[type]} docParsed [description]
   * @param  {[type]} visibity  [description]
   * @return {[type]}           [description]
   */
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
            bodyArray = bodyArray.concat($this.getBodyArrayFromClass(item, visibity))
            break
            
          case 'namespace':
            for (var c in item.children) {
              if (item.children[c].kind === 'class') {
                bodyArray = bodyArray.concat($this.getBodyArrayFromClass(item.children[c], visibity))
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
   * From a class we get the body content
   * 
   * @param  {[type]} theClass [description]
   * @param  {[type]} visibity [description]
   * @return {[type]}          [description]
   */
  PhpCompletion.prototype.getBodyArrayFromClass = function(theClass, visibity) {
    var $this = this
    var result = []
    for (var b in theClass.body) {
      var prop = theClass.body[b]
      if (visibity.indexOf(prop.visibility) !== -1) {
        result.push(prop)
      }
    }

    // Class parent
    if (theClass.extends) {
      var parentName = theClass.extends.name
      
      for (var f in $this.phpFiles) {
        if ($this.phpFiles[f].name.indexOf(parentName) !== -1) {
          result = result.concat($this.getBodyArray($this.getDocParsed($this.phpFiles[f]._contents), 'public|protected'))
        }
      } // Endfor

    } // End extends

    // For while we are not able to find Interface methods =/
    // 
    // if (theClass.implements) {
    //   for (var I in theClass.implements) {
    //     var Interface = theClass.implements[I]

    //     console.log(Interface.arguments())        
    //   }
    // }

    return result
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
      match: null,
      selectInitial: false,
      handleWideResults: true
    }
  }
  
  PhpCompletion.prototype.insertHint = function(hint) {
    var cursor = this.editor.getCursorPos();
    var lineBeginning = {line:cursor.line,ch:0};
    var textBeforeCursor = this.editor.document.getRange(lineBeginning, cursor);
    var indexOfTheSymbol = textBeforeCursor.indexOf(this.search);
    var replaceStart = {line:cursor.line,ch:indexOfTheSymbol};
    this.editor.document.replaceRange(hint.data('hintname'), replaceStart, cursor);
    
    // console.log(hint.data('hintname'))
    
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
