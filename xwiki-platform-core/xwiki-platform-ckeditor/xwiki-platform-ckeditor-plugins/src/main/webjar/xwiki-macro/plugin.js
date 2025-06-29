/*
 * See the NOTICE file distributed with this work for additional
 * information regarding copyright ownership.
 *
 * This is free software; you can redistribute it and/or modify it
 * under the terms of the GNU Lesser General Public License as
 * published by the Free Software Foundation; either version 2.1 of
 * the License, or (at your option) any later version.
 *
 * This software is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
 * Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public
 * License along with this software; if not, write to the Free
 * Software Foundation, Inc., 51 Franklin St, Fifth Floor, Boston, MA
 * 02110-1301 USA, or see the FSF site: http://www.fsf.org.
 */
(function() {
  'use strict';
  var $ = jQuery;

  // Declare the configuration namespace.
  CKEDITOR.config['xwiki-macro'] = CKEDITOR.config['xwiki-macro'] || {
    __namespace: true
  };

  // Macro widget template is different depending on whether the macro is in-line or not.
  var blockMacroWidgetTemplate =
    '<div class="macro" data-macro="">' +
      '<div class="macro-placeholder">macro:name</div>' +
    '</div>';
  var inlineMacroWidgetTemplate = blockMacroWidgetTemplate.replace(/div/g, 'span');

  const nestedEditableTypeAttribute = 'data-xwiki-non-generated-content';
  const nestedEditableNameAttribute = 'data-xwiki-parameter-name';

  var getNestedEditableType = function(nestedEditable) {
    var nestedEditableType;
    if (typeof nestedEditable.getAttribute === 'function') {
      // CKEDITOR.dom.element
      nestedEditableType = nestedEditable.getAttribute(nestedEditableTypeAttribute);
    } else if (nestedEditable.attributes) {
      // CKEDITOR.htmlParser.element
      nestedEditableType = nestedEditable.attributes[nestedEditableTypeAttribute];
    }
    if (typeof nestedEditableType === 'string') {
      // Remove whitespace from the type name in order to have a single string representation.
      nestedEditableType = nestedEditableType.replace(/\s+/g, '');
    }
    return nestedEditableType;
  };

  var withLowerCaseKeys = function(object) {
    var key, keys = Object.keys(object);
    var n = keys.length;
    var result = {};
    while (n--) {
      key = keys[n];
      result[key.toLowerCase()] = object[key];
    }
    return result;
  };

  CKEDITOR.plugins.add('xwiki-macro', {
    // CKEditor build fails if the requires string contains a concatenation. To match the line length limit, the string
    // is moved one line down.
    requires:
      'widget,balloontoolbar,notification,xwiki-marker,xwiki-loading,xwiki-localization,xwiki-selection,xwiki-dialog',

    init: function(editor) {
      var macroPlugin = this;

      // node: CKEDITOR.htmlParser.node
      var isInlineNode = function(node) {
        return node.type !== CKEDITOR.NODE_ELEMENT || CKEDITOR.dtd.$inline[node.name];
      };

      // node: CKEDITOR.htmlParser.node
      var getPreviousSibling = function(node, siblingTypes) {
        var i = node.getIndex() - 1;
        while (i >= 0) {
          var sibling = node.parent.children[i--];
          if (!siblingTypes || siblingTypes.indexOf(sibling.type) >= 0) {
            return sibling;
          }
        }
        return null;
      };

      // node: CKEDITOR.htmlParser.node
      var getNextSibling = function(node, siblingTypes) {
        var i = node.getIndex() + 1;
        while (i < node.parent.children.length) {
          var sibling = node.parent.children[i++];
          if (!siblingTypes || siblingTypes.indexOf(sibling.type) >= 0) {
            return sibling;
          }
        }
        return null;
      };

      // startMacroComment: CKEDITOR.htmlParser.comment
      // output: CKEDITOR.htmlParser.node[]
      var isInlineMacro = function(startMacroComment, output) {
        if (output.length > 0) {
          var i = 0;
          while (i < output.length && isInlineNode(output[i])) {
            i++;
          }
          return i >= output.length;
        } else {
          var previousSibling = getPreviousSibling(startMacroComment, [CKEDITOR.NODE_ELEMENT, CKEDITOR.NODE_TEXT]);
          var nextSibling = getNextSibling(startMacroComment, [CKEDITOR.NODE_ELEMENT, CKEDITOR.NODE_TEXT]);
          if (previousSibling || nextSibling) {
            return (previousSibling && isInlineNode(previousSibling)) || (nextSibling && isInlineNode(nextSibling));
          } else {
            return !CKEDITOR.dtd.$blockLimit[startMacroComment.parent.name];
          }
        }
      };

      // startMacroComment: CKEDITOR.htmlParser.comment
      // output: CKEDITOR.htmlParser.node[]
      var wrapMacroOutput = function(startMacroComment, output) {
        var wrapperName = isInlineMacro(startMacroComment, output) ? 'span' : 'div';
        var wrapper = new CKEDITOR.htmlParser.element(wrapperName, {
          'class': 'macro',
          'data-macro': startMacroComment.value
        });

        // Add the macro output.
        var hasPlaceholder = false;
        output.forEach(function(node) {
          node.remove();
          wrapper.add(node);
          hasPlaceholder = hasPlaceholder || isMacroPlaceholder(node);
        });

        // Add a placeholder to be used when the macro output is empty or not visible. Otherwise the user might not be
        // able to select the macro to edit its parameters for instance. We do this here and not when the macro widget
        // is initialized because the browser may add content (e.g. a non-breaking space or a BR tag) to make the
        // (usually block-level) empty macro wrapper editable before the macro widget is initialized. Note that we can't
        // check if the macro output is not visible at this point so we can't show the placeholder. We do this below
        // when the macro widget is initialized.
        if (!hasPlaceholder) {
          var placeholder = new CKEDITOR.htmlParser.element(wrapperName, {'class': 'macro-placeholder hidden'});
          var macroCall = macroPlugin.parseMacroCall(startMacroComment.value);
          var text = editor.localization.get('xwiki-macro.placeholder', macroCall.name);
          placeholder.add(new CKEDITOR.htmlParser.text(text));
          wrapper.add(placeholder, 0);
        }

        startMacroComment.replaceWith(wrapper);
      };

      /**
       * @param node an instance of CKEDITOR.htmlParser.node
       * @return true if the given node is a macro placeholder, false othewise
       */
      var isMacroPlaceholder = function(node) {
        return (node.name === 'div' || node.name === 'span') && node.hasClass('macro-placeholder');
      };

      var isWidgetVisible = function(widget) {
        // We don't use CKEDITOR.dom.element#isVisible() because we want to check that the widget has both width and
        // height, otherwise the user cannot select it (to edit it for instance).
        return isElementVisible(widget.element.$);
      };

      var ensureMacroWidgetVisible = function(macroWidget) {
        // Hide the macro placeholder by default (we want to check if the macro widget is visible without its
        // placeholder).
        const placeholder = $(macroWidget.element.$).children('.macro-placeholder').addClass('hidden');
        if (!isWidgetVisible(macroWidget)) {
          // Show the placeholder if the macro widget is not visible, either because the macro doesn't have ouput or
          // because its output is not visible).
          placeholder.removeClass('hidden');
        }
      };

      // Replace the macro marker comments with a DIV or SPAN in order to be able to initialize the macro widgets.
      editor.plugins['xwiki-marker'].addMarkerHandler(editor, 'macro', {
        toHtml: wrapMacroOutput
      });

      // Remove the bogus BR tags that are being added by the CKEDITOR.htmlDataProcessor.dataFilter to the empty blocks
      // from the macro output, since otherwise we can't detect if the macro output is visible or not in order to toggle
      // the macro placeholder.
      //
      // CKEDITOR.htmlDataProcessor.dataFilter is called on the 'toHtml' event with priority 10 and it adds a bogus BR
      // tag to all the empty block elements, including those from the read-only macro output. These bogus BR tags are
      // marked with the 'data-cke-bogus' attribute which is removed also by the same dataFilter in a different rule
      // that has priority 10. We're adding a rule to remove these bogus BR tags from the read-only macro output. This
      // rule must be applied after the bogus BR tags are added by the dataFilter but before the 'data-cke-bogus'
      // attribute is removed (with priority 10) so that we can identify the bogus BR tags.
      // See https://ckeditor.com/docs/ckeditor4/latest/api/CKEDITOR_editor.html#event-toHtml
      editor.dataProcessor?.dataFilter?.addRules({
        elements: {
          br: function(br) {
            if (br.attributes['data-cke-bogus'] === 1 && CKEDITOR.plugins.xwikiMacro.isMacroOutput(br)) {
              return false;
            }
          }
        }
      }, {
        applyToAll: true,
        priority: 9
      });

      editor.ui.addButton('xwiki-macro', {
        label: editor.localization.get('xwiki-macro.buttonHint'),
        command: 'xwiki-macro',
        toolbar: 'insert,40'
      });

      // See http://docs.ckeditor.com/#!/api/CKEDITOR.plugins.widget.definition
      editor.widgets.add('xwiki-macro', {
        requiredContent: 'div(macro,macro-placeholder)[data-macro];span(macro,macro-placeholder)[data-macro]',
        pathName: 'macro',
        upcast: CKEDITOR.plugins.xwikiMacro.isMacroElement,
        // The passed widgetElement is actually a clone of the widget element, of type CKEDITOR.htmlParser.element
        downcast: function(widgetElementClone) {
          var startMacroComment = new CKEDITOR.htmlParser.comment(widgetElementClone.attributes['data-macro']);
          var stopMacroComment = new CKEDITOR.htmlParser.comment('stopmacro');
          var macro = new CKEDITOR.htmlParser.fragment();
          macro.add(startMacroComment);
          if (editor.config.fullData) {
            widgetElementClone.children.forEach(function(child) {
              macro.add(child);
            });
          } else {
            // If the widget has nested editables we need to include them, otherwise their content is not saved.
            widgetElementClone.forEach(element => {
              const nestedEditableType = getNestedEditableType(element);
              if (nestedEditableType && element.attributes.contenteditable) {
                const parameterType = this.getParameterType(element.attributes[nestedEditableNameAttribute]);
                // Skip the nested editable if it doesn't match the expected parameter type.
                if (!parameterType || nestedEditableType === parameterType) {
                  macro.add(element);
                }
                return false;
              } else if (this.upcast(element)) {
                // Skip nested macros that are outside of a nested editable.
                return false;
              }
            }, CKEDITOR.NODE_ELEMENT, true);
          }
          macro.add(stopMacroComment);
          return macro;
        },
        getParameterType: function(name) {
          let parametersMap = (this.data.descriptor || {}).parameters || {};
          let parameterName = (name === undefined) ? '$content' : name.toLowerCase();
          let param = parametersMap[parameterName] || {};
          return param.type;
        },
        init: function() {
          // Initialize the nested editables.
          macroPlugin.initializeNestedEditables(this, editor);
          // Make sure the user can select the macro widget (e.g. to edit its parameters) by showing a placeholder text
          // when the macro output is not visible.
          if (editor.container.isVisible()) {
            ensureMacroWidgetVisible(this);
          } else {
            // The editor is not visible so we can't determine if the macro widget is visible. We can't detect when the
            // editor becomes visible either so the workaround we use is to ensure the macro is visible next time the
            // editor receives the focus (i.e. when the user starts editing).
            editor.once('focus', ensureMacroWidgetVisible.bind(null, this));
          }
          // Initialize the widget data.
          var data = macroPlugin.parseMacroCall(this.element.getAttribute('data-macro'));
          // Preserve the macro type (in-line vs. block) as much as possible when editing a macro.
          data.inline = this.inline;
          // Remove from the macro call the parameters that are editable in-place using nested editables.
          this.simplifyMacroCall(data);
          // Update the macro widget data.
          this.setData(data);
          // Allow JavaScript code to update the macro output after the widget is ready. We have to do this only once
          // (when the edited content is loaded initially or reloaded because a macro was updated or inserted),
          // otherwise we break the Undo/Redo history (because the Undo/Redo actions will create new history entries).
          if (this.element.getAttribute('data-xwiki-dom-updated') !== 'true') {
            this.once('ready', function() {
              this.element.setAttribute('data-xwiki-dom-updated', 'true');
              $(editor.document.$).trigger('xwiki:dom:updated', {'elements': [this.element.$]});
            });
          }
        },
        simplifyMacroCall: function(macroCall) {
          if (this.editables.$content) {
            delete macroCall.content;
          }
          Object.keys(this.editables).forEach(name => {
            const parameterName = Object.keys(macroCall.parameters)
                .find(key => key.toLowerCase() === name.toLowerCase());
            delete macroCall.parameters[parameterName];
          });
        },
        data: function(event) {
          this.element.setAttribute('data-macro', macroPlugin.serializeMacroCall(this.data));
          this.pathName = editor.localization.get('xwiki-macro.placeholder', this.data.name);
          // The elementspath plugin takes the path name from the 'data-cke-display-name' attribute which is set by the
          // widget plugin only once, based on the initial pathName property from the widget definition. We have to
          // update the attribute ourselves in order to have a dynamic path name (since the user can change the macro).
          this.wrapper.data('cke-display-name', this.pathName);
          $(this.element.$).children('.macro-placeholder').text(this.pathName);
        },
        edit: function(event) {
          // Prevent the default behavior because we want to use our custom dialog.
          event.cancel();
          // Our custom edit dialog allows the user to change the macro, which means the user can change from an in-line
          // macro to a block macro (or the other way around). As a consequence we may have to replace the existing
          // macro widget (in-line widgets and block widgets are handled differently by the editor).
          this.showMacroWizard(this.data);
        },
        insert: function(options) {
          var selectedText = (options.editor.getSelection().getSelectedText() || '').trim();
          // Macros that produce block level content shouldn't be inserted inline. But since the user hasn't picked the
          // macro yet we can only assume that if he selected multiple lines of text then he probably wants to insert a
          // block level macro. This is a temporary solution until we fix the rendering to stop generating invalid HTML.
          // See XRENDERING-517: Invalid HTML generated when a macro that is called inline produces block level content
          var inline = selectedText.indexOf('\n') > 0 ? false : this.inline;
          // The default macro call can be extended / overwritten by passing a macro call when executing the
          // 'xwiki-macro' editor command (this happens for instance when we execute a dedicated insert macro command).
          this.showMacroWizard($.extend({
            parameters: {},
            // Prefill the macro content text area with the selected text.
            content: selectedText,
            inline: inline
          }, options.commandData));
        },
        showMacroWizard: function(macroCall) {
          // We don't use _showMacroWizard directly as RequireJS callback because it is asynchronous and RequireJS has
          // issues with async callbacks. See https://github.com/requirejs/requirejs/issues/1694 .
          require(['macroWizard'], (macroWizard) => {
            this._showMacroWizard(macroWizard, macroCall);
          });
        },
        _showMacroWizard: async function(macroWizard, macroCall) {
          // Show the macro wizard to insert or edit a macro and wait for the result.
          const widget = this;
          const input = {
            macroCall,
            inlineParameters: Object.entries(widget.editables || {}).reduce((acc, [parameterName, editable]) => {
              acc[parameterName] = editable.getData();
              return acc;
            }, {}),
            showInlineParameters: (editor.config['xwiki-macro'] || {}).showInlineEditableParameters,
            sourceDocumentReference: editor.config.sourceDocument.documentReference,
            syntaxId: editor.config.sourceSyntax,
          };
          let output;
          try {
            output = await macroWizard(input);
          } catch (e) {
            // The macro wizard was canceled.
          }

          // Give the focus back to the editor after the modal is closed. We need to wait for the editor to be ready
          // because remote changes might have put the editor in loading mode while the macro wizard was open (e.g. if
          // another user inserted a macro which triggered a content refresh).
          await editor.toBeReady();
          editor.focus();

          // Update or insert the macro widget based on the output of the macro wizard.
          if (output) {
            macroPlugin.insertOrUpdateMacroWidget(editor, output, widget);
          }
        }
      });

      // Command to insert a macro directly without going through the Macro Wizard.
      editor.addCommand('xwiki-macro-insert', {
        async: true,
        requiredContent: editor.widgets.registered['xwiki-macro'].requiredContent,
        exec: function(editor, macroCall) {
          macroCall = $.extend({parameters: {}}, macroCall);
          if (!macroCall.name) {
            return;
          }

          macroPlugin.onceAfterRefresh(editor, () => {
            editor.fire('afterCommandExec', {name: this.name, command: this});
          });

          macroPlugin.insertOrUpdateMacroWidget(editor, macroCall);
        }
      });

      editor.addCommand('xwiki-refresh', {
        async: true,
        contextSensitive: false,
        editorFocus: false,
        readOnly: true,
        counter: 0,
        exec: function(editor, options) {
          options = Object.assign({
            preserveSelection: true
          }, options);
          if (options.preserveSelection) {
            CKEDITOR.plugins.xwikiSelection.saveSelection(editor);
          }
          editor.setLoading(true);
          CKEDITOR.plugins.xwikiSource.convertHTML(editor, {
            fromHTML: true,
            toHTML: true,
            text: editor.getData()
          }).done((html, textStatus, jqXHR) => {
            var requiredSkinExtensions = jqXHR.getResponseHeader('X-XWIKI-HTML-HEAD');
            require(['macroWizard'], () => {
              $(editor.document.$).loadRequiredSkinExtensions(requiredSkinExtensions);
            });
            editor.setData(html, {
              callback: () => {
                // The new content may contain widgets (e.g. macros) that need to be initialized.
                macroPlugin.waitForWidgetsToBeReady(editor).then(this.done.bind(this, true, options));
              }
            });
          }).fail(this.done.bind(this, false, options));
        },
        done: async function(success, options) {
          if (options.preserveSelection) {
            await CKEDITOR.plugins.xwikiSelection.restoreSelection(editor, {
              beforeApply: () => editor.setLoading(false)
            });
          } else {
            editor.setLoading(false);
          }
          if (!success) {
            editor.showNotification(editor.localization.get('xwiki-macro.refreshFailed'), 'warning');
          }
          // Increment the refresh counter and publish its value on the editable element to help functional tests detect
          // when the edited content has been refreshed. This is especially useful for realtime editing tests that use
          // multiple browser tabs: changing a macro in the first tab triggers a refresh of the content in the second
          // tab, but after switching to the second tab we can't rely on the editor loading state to determine if the
          // content was refreshed or not (the content might have been already refreshed or the changes from the first
          // tab might not have been applied yet).
          this.counter++;
          editor.editable()?.data('xwiki-refresh-counter', this.counter);
          editor.fire('afterCommandExec', {name: this.name, command: this});
        }
      });

      // Register the dedicated insert macro buttons.
      ((editor.config['xwiki-macro'] || {}).insertButtons || []).forEach(function(definition) {
        macroPlugin.maybeRegisterDedicatedInsertMacroButton(editor, definition);
      });

      // Command to quickly insert/install macros
      require(['macroService', 'l10n!macroSelector'], function (macroService, translations) {
        editor.addCommand('xwiki-macro-maybe-install-insert', {
          async: true,
          exec: function (editor, macroCall) {
            var command = this;

            // Find the macro we are going to insert.
            macroService.getMacros(editor.config.sourceSyntax).done(function (macros) {
              macros.forEach(function (macro) {
                if (macro.id.id === macroCall.id) {

                  // Helper function
                  var insertMacro = function (widget) {

                    // The insertion finishes after refresh.
                    macroPlugin.onceAfterRefresh(editor, () => {
                      editor.fire('afterCommandExec', {
                        name: command.name,
                        command: command
                      });
                    });

                    // Retrieve required parameters.
                    macroService.getMacroDescriptor(macro.id.id).done(function (descriptorUI) {
                      let descriptor = descriptorUI.descriptor;

                      // Show the insertion dialog if at least one of the parameters is mandatory.
                      if (descriptor.mandatoryNodes.length > 0) {
                        if (widget) {
                          // Edit existing pre-inserted macro.
                          widget.edit();
                        } else {
                          // Insert and edit macro.
                          editor.execCommand("xwiki-macro", {
                            name: macro.id.id
                          });
                        }
                        return;
                      }

                      // No mandatory parameters. Insert the macro without specifying any parameters.
                      macroPlugin.insertOrUpdateMacroWidget(editor, {
                        name: macro.id.id,
                        parameters: {},
                        // We consider the macro call to be inline if the macro supports inline mode, as indicated by
                        // its descriptor, because the caret is placed in an inline context most of the time (e.g.
                        // inside a paragraph) in order to allow the user to type text. Moreover, the
                        // 'xwiki-macro-maybe-install-insert' editor command is used mainly by quick actions which are
                        // triggered by the user typing text, so in an inline context.
                        inline: descriptor.supportsInlineMode
                      }, widget);
                    });
                  };

                  // Install the macro if it is installable.
                  if (macro.extensionId &&
                    macro.extensionName &&
                    macro.extensionVersion &&
                    macro.extensionInstallAllowed) {

                    // Request user confirmation.
                    if (!window.confirm(translations.get('install.confirm',
                        macro.extensionName,
                        macro.extensionVersion))) {
                      editor.showNotification(
                        editor.localization.get(
                          'xwiki-macro.installFailed',
                          macro.extensionName,
                          macro.extensionVersion
                        ),
                        'warning',
                        5000
                      );
                      editor.fire('afterCommandExec', {
                        name: command.name,
                        command: command
                      });
                      return;
                    }

                    // Recover the macro widget that will be pre-inserted.
                    editor.widgets.once('instanceCreated', function (evt) {

                      var notification = editor.showNotification(
                        editor.localization.get('xwiki-macro.installPending',
                        macro.extensionName,
                        macro.extensionVersion
                        ),
                        'progress',
                        0);
                      // Install the macro extension.
                      macroService.installMacro(macro.extensionId, macro.extensionVersion).done(function () {
                        notification.hide();
                        editor.showNotification(editor.localization.get('xwiki-macro.installSuccessful',
                                                                        macro.extensionName,
                                                                        macro.extensionVersion),
                                                'success',
                                                5000);
                        // Update the cache for future insertions.
                        macroService.getMacros(editor.config.sourceSyntax, true);

                        // Update the pre-inserted widget
                        insertMacro(evt.data);
                      }).fail(function () {
                        notification.hide();
                        editor.localization.get('xwiki-macro.installFailed',
                                                macro.extensionName,
                                                macro.extensionVersion);
                        editor.fire('afterCommandExec', {
                          name: command.name,
                          command: command
                        });
                      });
                    });

                    // Pre-insert macro and do not refresh to be able to edit the macro later.
                    macroPlugin.insertOrUpdateMacroWidget(editor, {
                      name: macro.id.id,
                      parameters: {},
                    }, undefined, true);

                    return;
                  }

                  insertMacro();
                }
              });
            });
          }
        });
      });

      this.toggleMacroPlaceholderOnDOMUpdate(editor);
    },

    // Setup the balloon tool bar for the nested editables, after the balloontoolbar plugin has been fully initialized.
    afterInit: function(editor) {
      // When the selection is inside a nested editable the macro widget button will insert a new macro so we need
      // another button to edit the current macro widget that holds the nested editable.
      editor.addCommand('xwiki-macro-edit', {
        // We want to enable the command only when the selection is inside a nested editable.
        context: true,
        contextSensitive: true,
        startDisabled: true,
        exec: function(editor) {
          this.getCurrentWidget(editor).edit();
        },
        refresh: function(editor, path) {
          // The nested editables are not marked as focused right away in Chrome so we need to defer the refresh a bit.
          setTimeout(this._refresh.bind(this, editor, path), 0);
        },
        _refresh: function(editor, path) {
          var currentWidget = this.getCurrentWidget(editor);
          if (currentWidget && currentWidget.name === 'xwiki-macro') {
            this.enable();
          } else {
            this.disable();
          }
        },
        getCurrentWidget: function(editor) {
          return editor.widgets.focused || editor.widgets.widgetHoldingFocusedEditable;
        }
      });

      editor.ui.addButton('xwiki-macro-edit', {
        label: editor.localization.get('xwiki-macro.editButtonHint'),
        command: 'xwiki-macro-edit',
        // We use a tool bar group that is not shown on the main tool bar so that this button is shown only on the
        // macro balloon tool bar.
        toolbar: 'xwiki-macro'
      });

      editor.balloonToolbars.create({
        buttons: 'xwiki-macro-edit,xwiki-macro',
        // Show the macro balloon tool bar when a nested editable is focused.
        cssSelector: 'div.macro div.xwiki-metadata-container.cke_widget_editable'
      });

      // Register Quick Actions

      require(['macroService', 'l10n!macroSelector'], function (macroService, translations) {

        // Icons used for Quick Actions
        var categoriesIcons = {
          Notifications: 'fa fa-bell',
          Content: 'fa fa-align-left',
          Development: 'fa fa-code',
          Formatting: 'fa fa-list-alt',
          Navigation: 'fa fa-sitemap',
          Layout: 'fa fa-object-group',
          Social: 'fa fa-users',
          _fallback: 'fa fa-cubes'
        };

        // Register macros in Quick Actions plugin
        macroService.getMacros(editor.config.sourceSyntax).done(function (macros) {

          // Keep track of how many groups we created
          var macroGroupsCount = 0;

          // List the category in order and provide the related attributes for the given macro
          var getCategoryAttributes = function (macro) {
            var attributes = {};

            // Same macro should always appear in the same group and default category should be first.
            var categories = macro.categories.sort((left, right) => {
              if (macro.defaultCategory && left.id !== right.id) {
                // Check against id and label because any of the two might be used.
                 if ([left.id, left.label].includes(macro.defaultCategory)) {
                   return -1;
                 } else if ([right.id, right.label].includes(macro.defaultCategory)) {
                   return 1;
                 }
              }
              return left.id.localeCompare(right.id);
            });

            // Add relevant group
            attributes.group = (categories[0] && categories[0].id) || 'Macro';

            // Create the group if it doesn't already exist
            if (!editor.quickActions.getGroup(attributes.group)) {
              editor.quickActions.addGroup({
                id: attributes.group,
                name: categories[0].label || attributes.group,
                order: 9000 + macroGroupsCount * 10
              });
              macroGroupsCount++;
            }

            // Add relevant iconClass
            attributes.iconClass = categoriesIcons[(categories[0] && categories[0].id)] ||
                categoriesIcons._fallback;

            // Add badge for each category, the first one will not be rendered
            // because the templating index starts at 1. All categories exceeding
            // the maximum number of badges will not be rendered either.
            categories.forEach(function (category, i) {
              attributes["badge" + i] = category.label;
            });

            // Add recommended badge
            if (macro.extensionRecommended) {
              attributes["badge" + editor.quickActions.config.maxBadges] = translations.get('recommended');
            }

            return attributes;
          };


          macros.forEach(function (macro) {
            // Do not add macros that are already registered.
            if (editor.quickActions.getAction('macro-' + macro.id.id) ||
              // Do not add macros that cannot be installed
              (macro.categories.some(function (cat) {
                return cat.id === "_notinstalled";
              }) && macro.extensionVersion && !macro.extensionInstallAllowed)) {
              return;
            }

            var item = {
              id: 'macro-' + macro.id.id,
              name: macro.name,
              description: macro.description,
              ...getCategoryAttributes(macro),
              command: {
                name: 'xwiki-macro-maybe-install-insert',
                data: {
                  id: macro.id.id
                }
              }
            };

            editor.quickActions.addAction(item);
          });
        });
      });
      // Ensure that widgets are always properly initialized after a paste.
      // Fix XWIKI-22391
      editor.on('afterPaste', function () {
        this.widgets.checkWidgets();
      });
    },

    insertOrUpdateMacroWidget: async function(editor, data, widget, skipRefresh) {
      await editor.toBeReady();

      // Save the editor state before inserting the macro in order to be able to undo the macro insertion.
      editor.fire('saveSnapshot');
      // Prevent the editor from recording Undo/Redo history entries while the edited content is being refreshed:
      // * if the macro is inserted then we need to wait for the macro markers to be replaced by the actual macro output
      // * if the macro is updated then we need to wait for the macro output to be updated to match the new macro data
      editor.fire('lockSnapshot', {dontUpdate: true});

      var expectedElementName = data.inline ? 'span' : 'div';
      if (widget?.element && !widget?.wrapper) {
        // It looks like the edited macro widget was destroyed while the Macro Editor modal was open (probably because
        // the content was updated, e.g. as a result of a remote change in a realtime session). We assume the selection
        // was preserved so we fallback on the macro widget that is currently active.
        widget = this.getActiveMacroWidget(editor);
      }
      var updatingWidget = !!widget?.element;
      if (updatingWidget && widget.element.getName() === expectedElementName) {
        // Ensure to use the nested editable values coming from the macroCall.
        this.cleanupEditables(editor, widget);
        // We have edited a macro and the macro type (inline vs. block) didn't change.
        // We can safely update the existing macro widget.
        widget.setData(data);
      } else {
        // We are either inserting a new macro or we are changing the macro type (e.g. from in-line to block). Changing
        // the macro type may require changes to the HTML structure (e.g. split the parent paragraph) in order to
        // preserve the HTML validity, so we have to replace the existing macro widget.
        this.createMacroWidget(editor, data);
        // When inserting an in-line macro we need to make sure that it stays inline after the edited content is
        // refreshed (rendering round-trip). The problem is that the rendering doesn't support inline-only macros. When
        // a macro is found alone inside a paragraph it is rendered as a block (when the content is refreshed), even if
        // the macro supports inline mode. This prevents the user from typing in the same paragraph after the macro was
        // inserted. We fix this by inserting an element after the macro which forces the inline rendering because the
        // macro is not anymore alone inside the paragraph. We remove this element after the content is refreshed.
        if (data.inline === 'enforce' && !updatingWidget && editor.widgets.focused) {
          var inlineEnforcer = new CKEDITOR.dom.element('span');
          inlineEnforcer.setAttribute('id', 'xwiki-macro-inline-enforcer');
          inlineEnforcer.appendText('\u00A0');
          inlineEnforcer.insertAfter(editor.widgets.focused.wrapper);
        }
      }

      // Unlock the Undo/Redo history after the edited content is updated.
      this.onceAfterRefresh(editor, () => {
        // Remove the element we added after the macro to force the inline rendering.
        var inlineEnforcer = editor.editable().findOne('span#xwiki-macro-inline-enforcer');
        if (inlineEnforcer) {
          // Place the caret after the inserted inline macro in order to allow the user to continue typing. We proceed
          // by inserting and non-breakable space after the inline enforcer. It is required to be cross-browser
          // compatible. Without these operations, the caret is not visible in Chrome after the inline macro
          // insertion.
          var space = new CKEDITOR.dom.text('\u00A0');
          space.insertAfter(inlineEnforcer);
          var range = editor.createRange();
          range.selectNodeContents(space);
          // Make the range of length zero (from endOffset to endOffset) so that a caret is displayed after the
          // space, instead of a selection of the space.
          range.setStartAfter(space, range.endOffset);
          editor.getSelection().selectRanges([range]);
          // Clean up the inline enforcer to avoid duplicates for the next inline macro insertion.
          inlineEnforcer.remove();
        }

        editor.fire('unlockSnapshot');
        // Save the editor state after the macro widget is inserted and initialized in order to be able to redo the
        // macro insertion. This also triggers the 'change' event allowing others to react to the macro insertion
        // (e.g. the real-time editing can propagate this change).
        editor.fire('saveSnapshot');
      }, skipRefresh);

      if (!skipRefresh) {
        // Refresh all the macros because a change in one macro can affect the output of the other macros.
        setTimeout(editor.execCommand.bind(editor, 'xwiki-refresh'), 0);
      }
    },

    cleanupEditables: function (editor, widget) {
      // remove the inplace editable elements only if the configuration allows to edit them in the macro config UI.
      if ((editor.config['xwiki-macro'] || {}).showInlineEditableParameters === true) {
        for (let item in widget.editables) {
          widget.editables[item].$.remove();
        }
      }
    },

    getActiveMacroWidget: function(editor) {
      let activeMacroWidget = editor.widgets.focused || editor.widgets.widgetHoldingFocusedEditable ||
        editor.widgets.selected[0];
      if (activeMacroWidget?.name !== 'xwiki-macro') {
        // Check if the selected element is a macro widget or is inside a macro widget.
        activeMacroWidget = editor.widgets.getByElement(editor.getSelection().getStartElement());
        if (activeMacroWidget?.name !== 'xwiki-macro') {
          activeMacroWidget = null;
        }
      }
      return activeMacroWidget;
    },

    onceAfterRefresh: function (editor, callback, skipRefresh) {
      if (skipRefresh) {
        callback();
      } else {
        const handler = editor.on('afterCommandExec', function (event) {
          if (event.data.name === 'xwiki-refresh') {
            handler.removeListener();
            callback();
          }
        });
      }
    },

    createMacroWidget: function(editor, data) {
      var widgetDefinition = editor.widgets.registered['xwiki-macro'];
      var macroWidgetTemplate = data.inline ? inlineMacroWidgetTemplate : blockMacroWidgetTemplate;
      var element = CKEDITOR.dom.element.createFromHtml(macroWidgetTemplate);
      var wrapper = editor.widgets.wrapElement(element, widgetDefinition.name);
      // Isolate the widget in a separate DOM document fragment.
      var documentFragment = new CKEDITOR.dom.documentFragment(wrapper.getDocument());
      documentFragment.append(wrapper);
      editor.widgets.initOn(element, widgetDefinition, data);
      editor.widgets.finalizeCreation(documentFragment);
    },

    waitForWidgetsToBeReady: function(editor) {
      const widgetsNotReady = Object.values(editor.widgets.instances).filter(widget => !widget.ready);
      if (widgetsNotReady.length) {
        return Promise.all(widgetsNotReady.map(widget => new Promise(resolve => widget.once('ready', resolve))));
      } else {
        return Promise.resolve();
      }
    },

    maybeRegisterDedicatedInsertMacroButton: function(editor, definition) {
      if (definition) {
        if (typeof definition === 'string') {
          definition = {
            macroCall: {
              name: definition
            }
          };
        } else if (typeof definition !== 'object' || typeof definition.macroCall !== 'object' ||
            definition.macroCall === null || typeof definition.macroCall.name !== 'string') {
          return;
        }
        definition.commandId = definition.commandId || 'xwiki-macro-' + definition.macroCall.name;
        // Macro parameter names are case-insensitive. Make all parameter names lowercase to ease the lookup.
        definition.macroCall.parameters = withLowerCaseKeys(definition.macroCall.parameters || {});
        this.registerDedicatedInsertMacroButton(editor, definition);
      }
    },

    registerDedicatedInsertMacroButton: function(editor, definition) {
      var macroPlugin = this;
      editor.addCommand(definition.commandId, {
        exec: function(editor) {
          // The macro can be inserted either direcly (using the parameter values specified in the macro call) or after
          // filling the missing parameter values in the Macro Editor dialog (which is prefilled with the parameter
          // values from the macro call).
          editor.execCommand(definition.insertDirectly ? 'xwiki-macro-insert' : 'xwiki-macro', definition.macroCall);
        }
      });
      editor.ui.addButton(definition.commandId, {
        label: editor.localization.get('xwiki-macro.dedicatedInsertButtonHint', definition.macroCall.name),
        command: definition.commandId,
        toolbar: 'insert,50'
      });
    },

    initializeNestedEditables: function(widget, editor) {
      var nestedEditableTypes = (editor.config['xwiki-macro'] || {}).nestedEditableTypes || {};
      // We look only for block-level nested editables because the in-line nested editables are not well supported.
      // See https://github.com/ckeditor/ckeditor-dev/issues/1091
      var nestedEditables = widget.element.find('div[' + nestedEditableTypeAttribute + ']');
      for (var i = 0; i < nestedEditables.count(); i++) {
        var nestedEditable = nestedEditables.getItem(i);
        // The specified widget can have nested widgets. Initialize only the nested editables that correspond to the
        // current widget.
        var nestedEditableOwner = nestedEditable.getAscendant(this.isDomMacroElement.bind(this));
        if (!widget.element.equals(nestedEditableOwner)) {
          continue;
        }
        var nestedEditableName = '$content';
        var nestedEditableSelector = 'div[' + nestedEditableTypeAttribute + ']:not([' +
          nestedEditableNameAttribute + '])';
        if (nestedEditable.hasAttribute(nestedEditableNameAttribute)) {
          nestedEditableName = nestedEditable.getAttribute(nestedEditableNameAttribute);
          nestedEditableSelector = 'div[' + nestedEditableNameAttribute + '="' + nestedEditableName + '"]';
        }
        var nestedEditableType = getNestedEditableType(nestedEditable);
        // Allow only plain text if the nested editable type is not known, in order to be safe.
        var nestedEditableConfig = nestedEditableTypes[nestedEditableType] || {allowedContent: ';'};
        widget.initEditable(nestedEditableName, {
          selector: nestedEditableSelector,
          allowedContent: nestedEditableConfig.allowedContent,
          disallowedContent: nestedEditableConfig.disallowedContent,
          pathName: nestedEditableName
        });
      }
    },

    // The passed element is of type CKEDITOR.dom.element (unlike the element passed to Widget#upcast which is of type
    // CKEDITOR.htmlParser.element, so we can't reuse that code).
    isDomMacroElement: function(element) {
      return (element.getName() == 'div' || element.getName() == 'span') &&
            element.hasClass('macro') && element.hasAttribute('data-macro');
    },

    parseMacroCall: function(startMacroComment) {
      // Unescape the text of the start macro comment.
      var text = CKEDITOR.tools.unescapeComment(startMacroComment);

      // Extract the macro name.
      var separator = '|-|';
      var start = 'startmacro:'.length;
      var end = text.indexOf(separator, start);
      var macroCall = {
        name: text.substring(start, end),
        parameters: {}
      };

      // Extract the macro parameters.
      start = end + separator.length;
      var separatorIndex = CKEDITOR.plugins.xwikiMarker.parseParameters(text, macroCall.parameters,
        start, separator, true);

      // Extract the macro content, if specified.
      if (separatorIndex >= 0) {
        macroCall.content = text.substring(separatorIndex + separator.length);
      }

      return macroCall;
    },

    serializeMacroCall: function(macroCall) {
      var separator = '|-|';
      var output = ['startmacro:', macroCall.name, separator,
        CKEDITOR.plugins.xwikiMarker.serializeParameters(macroCall.parameters)];
      if (typeof macroCall.content === 'string') {
        output.push(separator, macroCall.content);
      }
      return CKEDITOR.tools.escapeComment(output.join(''));
    },

    toggleMacroPlaceholderOnDOMUpdate: function(editor) {
      let cleanUp = () => {};
      editor.on('contentDom', function() {
        cleanUp();
        const doc = editor.document.$;
        $(doc).on("xwiki:dom:updated", onDOMUpdated);
        // We need to update the cleanUp function whenever the editing area is (re)created. For in-place edit mode this
        // happens only once (per editing session) while for standalone edit mode this happens multiple times (e.g.
        // when we switch to Source and back or when the edited content is refreshed).
        cleanUp = () => $(doc).off("xwiki:dom:updated", onDOMUpdated);
      });
      // We don't pass directly the cleanUp function because the cleanUp function may change during the lifetime of the
      // editor (e.g. when the editing area is recreated for the standalone edit mode).
      editor.on('beforeDestroy', () => cleanUp());

      function onDOMUpdated(event, data) {
        const editable = editor.editable()?.$;
        const macroElements = data.elements
          .flatMap(getMacroElements)
          .filter(element => editable?.contains(element))
          .sort((alice, bob) => {
            const delta = alice.compareDocumentPosition(bob);
            // We need to reverse the pre-order depth-first traversal in order to be able to handle the nested macros
            // first.
            if (delta & Node.DOCUMENT_POSITION_PRECEDING) {
              return -1;
            } else if (delta & Node.DOCUMENT_POSITION_FOLLOWING) {
              return 1;
            } else {
              return 0;
            }
          });
        // Hide all the affected macro placeholders first, to trigger a single repaint.
        macroElements.forEach(hideMacroPlaceholder);
        // Then show the macro placeholders where needed.
        macroElements.forEach(maybeToggleMacroPlaceholder);
      }

      function getMacroElements(root) {
        const macroElementSelector = '.macro.cke_widget_element[data-macro]';
        const macroElements = [...root.querySelectorAll(macroElementSelector)];
        const macroElementAncestor = root.closest(macroElementSelector);
        if (macroElementAncestor) {
          macroElements.push(macroElementAncestor);
        }
        return macroElements;
      }
    
      function hideMacroPlaceholder(macroElement) {
        macroElement.querySelector(':scope > .macro-placeholder')?.classList.add('hidden');
      }
    
      function maybeToggleMacroPlaceholder(macroElement) {
        const macroVisible = isElementVisible(macroElement);
        macroElement.querySelector(':scope > .macro-placeholder')?.classList.toggle('hidden', macroVisible);
      }
    }
  });

  function isElementVisible(element) {
    return element.offsetHeight > 0 && element.offsetWidth > 0;
  }

  CKEDITOR.plugins.xwikiMacro = {
    // The passed element is of type CKEDITOR.htmlParser.element
    isMacroElement: function(element) {
      return (element.name == 'div' || element.name == 'span') &&
        // The passed element doesn't always have the CKEDITOR.htmlParser.element API. This happens for instance when
        // CKEditor checks which plugins to disable (based on the HTML elements they require). In this case the passed
        // element only has the data (attributes, children, etc.).
        element.hasClass?.('macro') && element.attributes['data-macro'];
    },

    // The passed element is of type CKEDITOR.htmlParser.element
    isMacroOutput: function(element) {
      // CKEDITOR.htmlParser.element#getAscendant() doesn't check the element itself, so we have to do it.
      return isMacroElementOrBetweenMacroMarkers(element) ||
        element.getAscendant?.(isMacroElementOrBetweenMacroMarkers);
    }
  };

  /**
   * @param {CKEDITOR.htmlParser.element} element the element to check
   * @returns {@code true} if the given element is a macro output wrapper or is between macro marker comments,
   *          {@code false} otherwise
   */
  function isMacroElementOrBetweenMacroMarkers(element) {
    // The macro marker comments might have been already processed (e.g. in the case of nested editables) so we need to
    // look for a macro output wrapper also.
    if (CKEDITOR.plugins.xwikiMacro.isMacroElement(element)) {
      return true;
    }
    // Look for macro marker comments otherwise, taking into account that macro markers can be "nested".
    var nestingLevel = 0;
    var previousSibling = element;
    while (previousSibling.previous && nestingLevel <= 0) {
      previousSibling = previousSibling.previous;
      if (previousSibling.type === CKEDITOR.NODE_COMMENT) {
        if (previousSibling.value === 'stopmacro') {
          // Macro output end.
          nestingLevel--;
        } else if (previousSibling.value.substr(0, 11) === 'startmacro:') {
          // Macro output start.
          nestingLevel++;
        }
      }
    }
    return nestingLevel > 0;
  }

  // Overwrite CKEditor's HTML parser in order to prevent it from removing empty elements from generated macro output.
  // It's important to preserve the generated macro output as is, because these empty elements are often used:
  // * to display font icons (even on the default wiki home page)
  // * as placeholders that are replaced or enhanced by JavaScript code (e.g. the live table)
  var originalHTMLParserParse = CKEDITOR.htmlParser.prototype.parse;
  CKEDITOR.htmlParser.prototype.parse = function() {
    // The initial parsing context.
    var contextStack = [{
      // The number of start macro comments that have not been paired yet with a stop macro comment in this context.
      startMacro: 0
    }];

    var originalOnComment = this.onComment;
    this.onComment = function(comment) {
      // Update the parsing context when we encounter macro marker comments.
      if (comment === 'stopmacro') {
        // Macro output end.
        contextStack[contextStack.length - 1].startMacro--;
      } else if (comment.substring(0, 11) === 'startmacro:') {
        // Macro output start.
        contextStack[contextStack.length - 1].startMacro++;
      }

      return originalOnComment.apply(this, arguments);
    };

    var originalOnTagOpen = this.onTagOpen;
    this.onTagOpen = function(tagName, attributes, selfClosing) {
      var parentContext = contextStack[contextStack.length - 1];
      // Force the parser to preserve this tag if:
      // * it is on the list of tags that are not allowed to be empty AND
      // * itself or one of its parents are wrapped by macro marker comments AND
      // * it is not editable (some parts of a macro output can be editable)
      if (CKEDITOR.dtd.$removeEmpty[tagName] && (parentContext.startMacro > 0 ||
          (parentContext.inMacroOutput && !parentContext.editable))) {
        attributes['data-cke-survive'] = true;
      }

      // Push a new context whenever a tag is opened.
      contextStack.push({
        // Reset the number of start macro comments.
        startMacro: 0,
        // If this tag is part of a macro output then its child nodes are part of a macro output also.
        inMacroOutput: parentContext.inMacroOutput || parentContext.startMacro > 0,
        // The editable flag doesn't propagate down to nested macros (nested macros can be read-only).
        editable: (parentContext.editable && parentContext.startMacro <= 0) ||
          // We look only for block-level nested editables because the in-line nested editables are not well supported.
          // See https://github.com/ckeditor/ckeditor-dev/issues/1091
          (tagName === 'div' && attributes[nestedEditableTypeAttribute])
      });

      return originalOnTagOpen.apply(this, arguments);
    };

    var originalOnTagClose = this.onTagClose;
    this.onTagClose = function(tagName) {
      // Go back to the parent context.
      contextStack.pop();

      return originalOnTagClose.apply(this, arguments);
    };

    return originalHTMLParserParse.apply(this, arguments);
  };
})();
