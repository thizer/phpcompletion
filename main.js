/*jslint vars: true, plusplus: true, devel: true, nomen: true, regexp: true, indent: 4, maxerr: 50 */
/*global define, $, brackets, window */

/**
 *  Return true while the string starts as search param
 * 
 * str <==> search
 * $ === $this->                   (true)
 * $t === $this->                  (true)
 * $th === $this->                 (true)
 * $thi === $this->                (true)
 * $this === $this->               (true)
 * $this- === $this->              (true)
 * $this-> === $this->             (true)
 * $this->anythingelse === $this-> (true)
 * $otherstuff === $this->         (false)
 * 
 * @param  {[string]} search The therm you wanna search for
 * @return {[bool]}        
 */
String.prototype.startsWithAny = function(search) {
  var len = (this.length > search.length) ? search.length : this.length
  // console.log([search.substr(0, len), this.substr(0, len)])
  return (search.substr(0, len) === this.substr(0, len))
}

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
    this.isThisRegexp = /^\$(this|thi|th|t)?(-\>)?/

    this.insertIndex
    this.editor
    this.lastChar
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
   * @return {[type]}            [description]
   */
  PhpCompletion.prototype.extractClassObjs = function(doc) {
    var $this = this
    var hints = []

    var docParsed = $this.getDocParsed(doc)
    var bodyArray = $this.getBodyArray(docParsed)
    
    for (var i in bodyArray) {
      
      var prop = bodyArray[i].propObj
      
      // If the hint doesnt match the search
      if ((this.search !== '') && (prop.name.toLowerCase().indexOf(this.search) === -1)) {
        continue;
      }

      hints.push(this.getHtmlHint(
        prop.name,
        ((prop.kind === 'method') ? prop.arguments : false),
        prop.leadingComments,
        prop.visibility,
        ((bodyArray[i].inherited) ? bodyArray[i].className : false)
      ))
    }
    return hints
  }

  PhpCompletion.prototype.getHtmlHint = function(hintname, args, comment, visibility, inherited) {
    var $this = this

    if (!hintname) {
      return false
    }
    if (undefined === args) {
      args = false
    }
    if (undefined === comment) {
      comment = false
    }
    if (undefined === visibility || !visibility) {
      visibility = 'Unknown type'
    }
    if (undefined === inherited) {
      inherited = false
    }

    var hint = $('<span>').attr({
      "id": "thizer-"+hintname.toLowerCase(),
      "class": "thizer-hint",
      "data-content": hintname
    })
    
    /**
     * Comments
     */
    if (comment) {
      var commentSpan = $("<span>").attr({
        "class": "thizer-comment",
        "style": "display: none;"
      })
      
      for (var c in comment) {
        var com = comment[c].value.split('\n')

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
            commentText = comLine+" [more...]"
          }
        }

        /** Comments must to be small (2 lines only) */
        commentSpan.html("/** "+commentText+commentAnn+" */")
      }
      
      hint.append(commentSpan)
    }
    
    /** Hint itself **/
    var def = $('<span>').attr({
      'class': 'thizer-hint-def'
    })
    switch (visibility) {
      case 'public':
        def.append('<i class="fa fa-globe-americas thizer-type thizer-type-success" title="'+visibility+'"></i> ')
        break;
      case 'protected':
        def.append('<i class="fa fa-map-marker-alt thizer-type thizer-type-warning" title="'+visibility+'"></i> ')
        break;
      case 'private':
        def.append('<i class="fa fa-lock thizer-type thizer-type-danger" title="'+visibility+'"></i> ')
        break;
      case 'Unknown type':
        def.append('<i class="fa fa-question thizer-type thizer-type-unknown" title="'+visibility+'"></i> ')
        break;
      default:
        def.append('<span class="thizer-type thizer-type-other" title="'+visibility+'">'+visibility.substr(0,1)+'</span> ')
    }
    
    // Hint is a method
    if (args) {
      var argStr = ''
      for (var a in args) {
        argStr += ', $'+args[a].name
      }
      hintname += '('+(argStr.replace(', ', ''))+')'

      // Must update $('.thizer-hint').data('hintname')
      hint.data('content', hintname)
    }

    // if (prop.kind === 'classconstant') {
    //   hintname += ' = '+prop.value.raw
    // }
    def.append(hintname)

    // Is inherited so we show the parent name (float right)
    if (inherited) {
      def.append('&nbsp;<span class="thizer-hint-parent">'+inherited+'</span>')
    }
    hint.append(def)

    return hint
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
          "loc": theClass.loc
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

  /**
   * This method return the list of objects by the kind
   * By default assign objects (either arguments)
   * 
   * @param  {[type]} objs [description]
   * @param  {[type]} kind [description]
   * @return {[type]}      [description]
   */
  PhpCompletion.prototype.findBlocks = function(objs, kind) {
    var $this = this
    var result = []
    // var scopeBlocks = "namespace|class|if|else|elseif|try|catch|finally|method|function|for|foreach|"

    if (undefined === kind) {
      kind = 'assign'
    }

    if (typeof objs === 'object') {
      for (var i in objs) {
        var item = objs[i]

        if (null === item) {
          continue
        } else if (item.hasOwnProperty('loc')) {

          // Already below the current line?
          if (item.loc.start.line > $this.cursor.line) {
            break

          }
        }

        // Get arguments
        if (item.hasOwnProperty('arguments')) {
          for (var a in item.arguments) {
            if (item.arguments[a].kind === 'parameter') {
              result.push(item.arguments[a])
            }
          }
        }

        if (item.hasOwnProperty('kind') && kind.indexOf(item.kind) !== -1) {
          result.push(item)
        } else {
          result = result.concat($this.findBlocks(item, kind))
        }
      }
    }
    return result
  }

  /**
   * Return true if the cursor is after start loc and before end loc
   */
  PhpCompletion.prototype.isCursorInside = function(loc) {
    // console.log(loc.start.line+' < '+this.cursor.line+' > '+loc.end.line)
    return ((loc.start.line < this.cursor.line) && (this.cursor.line < loc.end.line))
  }

  /**
   * No matter what we do, the completion will be added from here.
   * We must to provide in the 'this.whatIsIt' object the correct string
   * to be prepended to the hintname
   * 
   * @param {[type]} fromText [description]
   */
  PhpCompletion.prototype.setInsertIndex = function(fromText) {
    if (undefined === this.editor) {
      return 0
    }

    var cursor = this.editor.getCursorPos()
    var textBeforeCursor = this.editor.document.getRange({ line:cursor.line, ch: 0 }, cursor);
    this.insertIndex = cursor.ch

    if (fromText !== '') {
      this.insertIndex = textBeforeCursor.indexOf(fromText);
    }
    return this.insertIndex
  }

  /**
   * Return a list of php predefined vars from php manual
   * http://php.net/manual/en/reserved.variables.php
   */
  PhpCompletion.prototype.getPredefinedVariables = function() {
    return [
      {name: 'this'},
      {name: '_SERVER'},
      {name: '_GET'},
      {name: '_POST'},
      {name: '_FILES'},
      {name: '_REQUEST'},
      {name: '_SESSION'},
      {name: '_ENV'},
      {name: '_COOKIE'},
      {name: 'phperrormsg'},
      {name: 'HTTP_RAW_POST_DATA'},
      {name: 'http_response_header'},
      {name: 'argc'},
      {name: 'argv'}
    ]
  }

  PhpCompletion.prototype.hintExists = function(hintname) {
    var exists = false

    // It is a jquery object?
    if (typeof hintname === 'object') {
      hintname = hintname.data('content')
    }

    for(var i in this.hints) {
      if (this.hints[i].data('content') === hintname) {
        exists = true
        break
      }
    }
    return exists
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
    this.lastChar = implicitChar
    this.cursor = editor.getCursorPos()
    var curCharPos = this.cursor.ch
    var curLinePos = this.cursor.line
    var lineStr = editor._codeMirror.getLine(curLinePos)
    // var totalLines = editor._codeMirror.doc.size

    this.whatIsIt = lineStr.substr(0, curCharPos).replace(/.+(\s|\(|\,|\.)/, '')
    this.search = lineStr.substr(0, curCharPos).replace(/.+(\s|\(|\,|\.)/, '')
    
    // Get Variables
    if (this.whatIsIt.indexOf('$') !== -1) {
      // Remove everything before $
      this.whatIsIt = '$'+(this.whatIsIt.replace(/(.+)?\$/gi, ''))
    }

    if (this.whatIsIt === '') {
      return false
    }

    /**
     * The found hint will be added from this word
     */
    this.setInsertIndex(this.whatIsIt)

    /**
     * Depending on the type of element we'll get
     * hints to complete the code
     */
    if (this.whatIsIt.indexOf('$this->') !== -1) {

      this.whatIsIt = '$this->'

      // Redefine the search term and look for it into classes
      this.search = this.search.replace(this.isThisRegexp, '')
      var classHints = this.extractClassObjs(editor.document)
      
      for (var i in classHints) {
        if (!this.hintExists(classHints[i])) {
          this.hints.push(classHints[i])
        }
      }

    } else if (this.whatIsIt[0] === '$') {

      if (this.whatIsIt.indexOf('>') !== -1) {
        console.log('A class instance object')
      } else {

        var docParsed = this.getDocParsed(editor.document)
        var scope = [].concat(this.findBlocks(docParsed.children), this.getPredefinedVariables())
        this.whatIsIt = ''

        for (var h in scope) {
          var hint = scope[h]
          var hintname = null

          if (undefined !== hint.name) {
            hintname = '$'+hint.name
          } else if (undefined !== hint.left.name) {
            hintname = '$'+hint.left.name
          }
          
          // The hint contains the search?
          if (!hintname || hintname.toLowerCase().indexOf(this.search.toLowerCase()) === -1) {
            continue
          }
          
          // Add if not exists yet
          if (!this.hintExists(hintname)) {
            this.hints.push(this.getHtmlHint(hintname, false, false, '$ Variable', false))
          }
        }
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
    /** Fix type delay */
    if (implicitChar !== this.lastChar) {
      return false
    }

    return {
      hints: this.hints,
      match: null,
      selectInitial: false,
      handleWideResults: true
    }
  }
  
  PhpCompletion.prototype.insertHint = function(hint) {
    var $this = this

    // console.log($this.whatIsIt)
    // console.log(hint.data('content'))

    var hinttext = String($this.whatIsIt + hint.data('content'))

    // Replace in editor with hint content
    $this.editor.document.replaceRange(
      hinttext,
      { line: $this.cursor.line, ch: $this.insertIndex },
      $this.cursor
    );
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
