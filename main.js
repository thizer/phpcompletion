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
      
      console.log(bodyArray[i])

      var prop = bodyArray[i].propObj
      var hintname = prop.name
      
      // console.log([hintname.toLowerCase(), this.search, hintname.toLowerCase().indexOf(this.search)])

      // If the hint doesnt match the search
      if ((this.search !== '') && (hintname.toLowerCase().indexOf(this.search) === -1)) {
        continue;
      }

      var hint = $('<span>').attr({
        "id": "thizer-"+hintname.toLowerCase(),
        "class": "thizer-hint",
        "data-content": hintname
      })
      
      /**
       * Comments
       */
      if (undefined !== prop.leadingComments) {
        var commentSpan = $("<span>").attr({
          "class": "thizer-comment",
          "style": "display: none;"
        })
        
        for (var c in prop.leadingComments) {
          var com = prop.leadingComments[c].value.split('\n')

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
      switch (prop.visibility) {
        case 'public':
          def.append('<i class="fa fa-globe-americas thizer-text-success" title="Public"></i> ')
          break;
        case 'protected':
          def.append('<i class="fa fa-map-marker-alt thizer-text-warning" title="Protected"></i> ')
          break;
        case 'private':
          def.append('<i class="fa fa-lock thizer-text-danger" title="Private"></i> ')
          break;
      }
      
      // Hint is a method
      if (prop.kind === 'method') {
        var args = ''
        for (var a in prop.arguments) {
          args += ', $'+prop.arguments[a].name
        }
        hintname += '('+(args.replace(', ', ''))+')'

        /**
         * Must update $('.thizer-hint').data('hintname')
         */
        hint.data('content', hintname)
        
      } else if (prop.kind === 'classconstant') {
        hintname += ' = '+prop.value.raw
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
  PhpCompletion.prototype.getBodyArray = function(docParsed, visibity, inherited) {
    var $this = this
    var bodyArray = []
    
    if (undefined === visibity) {
      visibity = 'public|protected|private'
    }

    if (undefined === inherited) {
      inherited = false
    }
    
    if ((undefined !== docParsed) && (!docParsed.errors.length)) {
      for (var i in docParsed.children) {
        var item = docParsed.children[i]
        
        switch (item.kind) {
          case 'class':
            
            // Check for visibility
            bodyArray = bodyArray.concat($this.getBodyArrayFromClass(item, visibity, inherited))
            break
            
          case 'namespace':
            for (var c in item.children) {
              if (item.children[c].kind === 'class') {
                bodyArray = bodyArray.concat($this.getBodyArrayFromClass(item.children[c], visibity, inherited))
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
  PhpCompletion.prototype.getBodyArrayFromClass = function(theClass, visibity, inherited) {
    var $this = this
    var result = []
    for (var b in theClass.body) {
      var prop = theClass.body[b]
      if (visibity.indexOf(prop.visibility) !== -1) {

        result.push({
          "propObj": prop,
          "inherited": (inherited ? true : false),
          "className": theClass.name,
          "pos": theClass.pos
        })
      }
    }

    // Class parent
    if (theClass.extends) {
      var parentName = theClass.extends.name
      
      for (var f in $this.phpFiles) {
        if ($this.phpFiles[f].name.indexOf(parentName) !== -1) {
          result = result.concat($this.getBodyArray($this.getDocParsed($this.phpFiles[f]._contents), 'public|protected', true))
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

  PhpCompletion.prototype.findScopeByStr = function(str, doc) {
    var $this = this
    var scope = []
    var docParsed = this.getDocParsed(doc)

    for (var p in docParsed.children) {
      var program = docParsed.children[p]

      // assign
      // function if inside
      // class if inside
      // namespace if inside
      
      switch (program.kind) {
        case 'function':

          break;
        case 'class':

          for (var m in program.body) {
            var method = program.body[m]
            if (method.kind == 'method') {

              if ($this.isCursorInside(method.body.loc)) {
                if (method.arguments.length) {
                  scope.push(method.arguments)
                }
                scope = scope.concat(method.body.children)
                break
              }

            }
          } // End for

          break;
        case 'namespace':

          for (var c in program.children) {
            var theClass = program.children[c]
            if (theClass.kind == 'class') {

              for (var m in theClass.body) {
                var method = theClass.body[m]
                if (method.kind == 'method') {

                  if ($this.isCursorInside(method.body.loc)) {
                    if (method.arguments.length) {
                      scope.push(method.arguments)
                    }
                    scope = scope.concat(method.body.children)
                    break
                    break
                  }

                }
              } // End for

            }
          } // End for

          break;
        case 'try':

          var theTry = program

          // Cursor is inside the 
          if ($this.isCursorInside(theTry.body.loc)) {
            scope = scope.concat(theTry.body.children)
          } else {
            // Here means that the cursor is inside one of the catch blocks 
            for (var ca in theTry.catches) {
              if ($this.isCursorInside(theTry.catches[ca].loc)) {
                scope = scope.concat(theTry.catches[ca].body.children)
                break
              }
            }
          }

          break;
        default:
          // console.log(docParsed)
      }
    }
    return scope
  }

  /**
   * Return true if the cursor is after start loc and before end loc
   */
  PhpCompletion.prototype.isCursorInside = function(loc) {
    // console.log(loc.start.line+' < '+this.cursor.line+' > '+loc.end.line)
    return ((loc.start.line < this.cursor.line) && (this.cursor.line < loc.end.line))
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
    // var totalLines = editor._codeMirror.doc.size

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

    } else if (this.whatIsIt[0] === '$') {

      if (this.whatIsIt.indexOf('>') !== -1) {
        console.log('A class instance object')
      } else {

        var scope = this.findScopeByStr(this.search, editor.document)

        console.log(scope)
      }

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

    var cursor = this.editor.getCursorPos()
    var textBeforeCursor = this.editor.document.getRange({ line:cursor.line, ch: 0 }, cursor);

    var indexOfTheSymbol = cursor.ch
    if (this.search !== '') {
      indexOfTheSymbol = textBeforeCursor.indexOf(this.search);
    }
    
    // Replace in editor with hint content
    this.editor.document.replaceRange(hint.data('content'), {
      line: cursor.line,
      ch: indexOfTheSymbol
    }, cursor);

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
