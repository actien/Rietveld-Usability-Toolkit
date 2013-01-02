chrome.extension.sendMessage({action: 'show_page_action'}, function(response) {});

function createFrameForLink(link) {
  var id = link.data().frameId;
  var href = link.data().diff;
  var frame = $('<iframe id="' + id + '"/>')
    .addClass('rb-inlineDiff')
    .css('width', '100%')
    .attr('frameBorder', '0')
    .data({ href: href })
    .hide();
  // TODO: Can we defer injecting the frame until we actually start loading it?
  var rowId = id.match('inline_diff_row_[0-9]*')[0];
  $('#' + rowId)
    .find('.rb-frameDiv')
    .append(frame);
  return frame;
}

function getFrameForLink(link) {
  var frame = $("#" + link.data().frameId);
  if (frame.length == 0) {
    frame = createFrameForLink(link);
  }
  return frame;
}

function getFrameForColumnId(row, id) {
  var difflink = row.find('.' + id);
  if (difflink.length == 0) return null;
  return getFrameForLink(difflink);
}

function updateShowingFrameId(row, newId) {
  row.data({ showingFrameId: newId });
  updateLinksForRow(row);
}

// Update the links in the previous row so that when an inline diff is shown,
// the proper link is highlighted.
function updateLinksForRow(row) {
  var showingFrameId = row.data().showingFrameId;
  var links = row.prev().find('.rb-diffLink');
  links.removeClass('rb-showingDiff');
  links.filter(function() {
      return $(this).data().frameId == row.data().showingFrameId
    }).addClass('rb-showingDiff');
}

function hideFrame(row, finished) {
  cancelLoadIfPending(row.data().loadingFrameId);
  row.data({ loadingFrameId: null });

  var frameId = row.data().showingFrameId;
  var currFrame = $('#' + frameId);
  updateShowingFrameId(row, null);
  row.find('.rb-frameDiv').slideUp(400, function() {
      row.hide();
      if (finished) finished();
    });
}

function swapFrame(row, frame) {
  var frameId = row.data().showingFrameId;
  var currFrame = $('#' + frameId);
  cancelLoadIfPending(frameId);
  currFrame.hide();
  frame.show();
  updateShowingFrameId(row, frame.attr('id'));
}

function showFrame(row, frame, finished) {
  var currFrameId = row.data().showingFrameId;
  if (currFrameId) {
    swapFrame(row, frame);
    return;
  }

  var spinner = row.find('.rb-spinner');
  var spinnerShowing = row.data().spinnerShowing;

  row.show();
  frame.show();
  updateShowingFrameId(row, frame.attr('id'));
  row.find('.rb-frameDiv').slideDown(400, function() {
      if (finished) finished();
    });
}

function toggleFrame(frame) {
  if (!frame.data().frameLoaded) {
    queueFrameLoad(frame);
    return;
  }
  var row = frame.closest('tr'),
    frameId = frame.attr('id'),
    currFrameId = row.data().showingFrameId;
  if (currFrameId == frameId) {
    hideFrame(row);
  } else {
    showFrame(row, frame);
  }
}

function showSpinner(row, duration, finished) {
  if (!duration) duration = 400;
  // FIXME: show the spinner.
  hideFrame(row, function() {
      row.show();
      row.data({ spinnerShowing: true });
      row.find('.rb-spinner').slideDown(duration, function() {
          if (finished) finished();
        });
    });
}

function hideSpinner(row, duration, finished) {
  if (!duration) duration = 400;
  row.data({ spinnerShowing: false });
  row.find('.rb-spinner').slideUp(duration, function() {
      if (finished) finished();
    });
}

function hideAllDiffs(tables) {
  // Hide all currently showing inline diffs.
  tables.find('.rb-frameRow').each(function() {
    hideFrame($(this));
  });
}

function queueFrameLoad(frame) {
  var row = frame.closest('tr');
  var priority = row.index();
  var frameId = frame.attr('id');
  var frameDiv = frame.closest('.rb-frameDiv');

  showSpinner(row, frameId);
  row.data({ loadingFrameId: frameId });

  pushLoadQueue(frameId, priority, function(finished) {
    chrome.storage.sync.get(['autoSetColumnWidth', 'columnWidthMap'], function(items) {
      var src = frame.data().href;
      if (frame.attr('src') == src) {
        // Frame is already loaded or loading.
        return;
      }
      if (items['autoSetColumnWidth']) {
        var filetype = src.substr(src.lastIndexOf('.') + 1);
        if (filetype in items['columnWidthMap'])
          src += '?column_width=' + items['columnWidthMap'][filetype];
      }
      frameDiv.css('top', '-50px');
      frame.attr('src', src);
      frame.one('load', function() {
        iframeLoaded(frame.attr('id'));
        if (row.data().loadingFrameId == frameId) {
          showFrame(row, frame, function() {
            hideSpinner(row, 1, function() {
                frameDiv.css('top', '0px');
              });
          });
        }
        if (finished) finished();
      });
    });
  });
}

function toggleFrameForLink(link) {
  toggleFrame(getFrameForLink(link));
}

function removeDiffChrome(page) {
  var code = page.find(".code");
  code.parents().andSelf()
    .css('margin', '0')
    .css('display', 'table')
    .siblings()
      .hide();
  code.find(".codenav").hide();
}

function iframeLoaded(id) {
  var frame = $("#" + id);
  frame.data({ frameLoaded: true });
  var row = frame.closest('tr');

  var inner = frame.contents();

  var resizer = function() {
    var newHeight = inner.outerHeight(true);
    var newWidth = inner.outerWidth(true);
    if (frame.css('height') != newHeight || frame.css('width') != newWidth) {
      // FIXME: This is a total hack. When the page in the iframe gets
      // smaller, its document still fills the iframe, and so newHeight/Width
      // above are larger than we want. If we first make the frame small (not
      // too small, because that causes the outer page to scroll), the
      // document will then shrink to the size of its interior. There should
      // be a better way to do this.
      newHeight = inner.find('html').height();
      newWidth = inner.find('html').width();
      frame.css('height', newHeight).css('width', newWidth);
      newHeight = inner.outerHeight(true);
      newWidth = inner.outerWidth(true);
      frame.css('height', newHeight).css('width', newWidth);
    }
  };

  // FIXME: more hacks. Without this, the new frame flashes at the left edge
  // of the row before moving to the center.
  frame.css('height', '0px').css('width', '0px');
  removeDiffChrome(inner);
  // Sometimes we get scrollbars in the frame when we don't actually need them.
  // Let's hammer those away. (What happens when we actually need them?)
  inner.find('html').css('overflow', 'hidden')

  // The observer must be installed before the first resizer() call (otherwise
  // we may miss a modification between the resizer() call and observer
  // installation).
  var observer = new WebKitMutationObserver(resizer);
  observer.observe(inner[0], { attributes: true, subtree: true } );
  resizer();
}

function updatePatchTables() {
  chrome.storage.sync.get(['rewriteUnifiedLinks', 'enableInlineDiffs', 'createViewAllButtons'], function(items) {
    var shouldRewrite = items['rewriteUnifiedLinks'];
    var enableInline = items['enableInlineDiffs'];
    var createViewAll = items['createViewAllButtons'];

    $('.rb-tableHeader.rb-modified').toggle(createViewAll);
    $('.rb-tableHeader.rb-original').toggle(!createViewAll);

    if (!enableInline) {
      hideAllDiffs($('.rb-patchTable'));
    }

    $('.rb-diffLink').off('click');

    $('.rb-filename')
      .toggleClass('rb-diffLink', shouldRewrite)
      .each(function() {
        this.href = $(this).data(shouldRewrite ? 'diff' : 'patch');
      });

    if (enableInline) {
      $('.rb-diffLink')
        .click(function() {
          toggleFrameForLink($(this));
          return false;
        });
    }
  });
}
chrome.storage.onChanged.addListener(updatePatchTables, ['rewriteUnifiedLinks', 'enableInlineDiffs', 'createViewAllButtons']);

function frameIdSuffixFromDiffHref(href) {
  return '_frame_' + href.match('/diff2?/([^/]*)/')[1].replace(':', '_');
}

function showAllFramesInColumn(table, columnId) {
  table.find('.rb-diffRow').each(function() {
    var frame = getFrameForColumnId($(this), columnId);
    console.log(columnId, $(this).attr('id'), frame);
    if (frame) {
      toggleFrame(frame);
    } else {
      hideFrame($(this).next());
    }
  });
}

function addShowButton(cell, columnId, text) {
  if (cell.find('.' + columnId).length > 0) return;

  var button = $('<input type="button" value="' + text + '"/>')
    .addClass('rb-headerButton')
    .addClass('rb-blueButton')
    .addClass(columnId)
    .data({ columnId: columnId })
    .click(function() {
      showAllFramesInColumn(cell.closest('.rb-patchTable'), columnId);
    });
  var siblingsBefore = cell.find('input').filter(function() {
    var otherId = $(this).data().columnId;
    if (otherId.length < columnId.length) return true;
    return otherId < columnId;
  });
  if (siblingsBefore.length > 0) {
    siblingsBefore.last().after(button);
  } else {
    cell.prepend(button);
  }
}

function createSpinner() {
  var spinner = $('<div/>')
    .addClass('rb-spinner')
    .css('position', 'relative')
    .css('z-index', '0')
    .css('height', '50px');;
  for (var i = 0; i < 12; i++) {
    spinner.append($('<div/>').addClass('rb-bar' + i));
  }
  return spinner;
}

function createFrameDiv() {
  return $('<div/>')
    .addClass('rb-frameDiv')
    .css('overflow', 'hidden')
    .css('position', 'relative')
    .css('z-index', '1');
}

function createFrameContainer() {
  return div = $('<div/>')
    .addClass('rb-frameContainer')
    .css('width', '100%')
    .css('text-align', 'center')
    .append(createSpinner())
    .append(createFrameDiv());
}

function createFrameRow() {
  return $('<tr id="' + rowId + '"/>')
    .addClass('rb-frameRow')
    .data({ showingFrameId: null })
    .append(
      $('<td colspan=1000/>')
        .append(createFrameContainer()))
    .hide();
}

function createHideAllButton() {
  return $('<input type="button" value="Hide all"/>')
    .addClass('rb-headerButton')
    .addClass('rb-redButton')
    .click(function() {
      hideAllDiffs($(this).closest('.rb-patchTable'));
    });
}

var currentId = 0;
// Inject some data and elements to the DOM to make modifications (and
// reversals) easier.
function injectDataAndNodes() {
  // Modify table header rows.
  $('.issue-list table:not(.rb-patchTable)')
    .addClass('rb-patchTable')
    .find('tr:first-of-type')
    .addClass('rb-tableHeader')
    .addClass('rb-original')
    .each(function() {
      var modified = $(this).clone()
        .removeClass('rb-original')
        .addClass('rb-modified')
        .hide();
      $(this).after(modified);

      modified.children().addClass('rb-headerCell');

      var unified = modified.children().eq(1)
        .addClass('rb-unifiedHeader');
      var hideAll = $('<div/>')
        .addClass('rb-hideAll')
        .css('float', 'right');
      hideAll.append(createHideAllButton());

      unified.append(hideAll);

      var diff = unified.next()
        .addClass('rb-diffHeader')
        .html('');

      addShowButton(diff, 'rb-columnView', 'Show All');

      var delta = diff.next()
        .addClass('rb-deltaHeader')
        .html('');
    });


  var difflinks = $('.issue-list a[href*="/diff"]:not(.rb-diffLink)')
    .addClass('rb-diffLink');

  // Update rows first since frameId is based on rowId
  difflinks.closest('tr:not(.rb-diffRow)')
    .addClass('rb-diffRow')
    .each(function() {
      rowId = "inline_diff_row_" + currentId++;

      $(this).find('a').andSelf().data({ rowId: rowId });

      $(this).after(createFrameRow(rowId));
    });

  difflinks.each(function() {
    var href = this.href;
    var frameId = $(this).data().rowId + frameIdSuffixFromDiffHref(href);
    $(this).data({ frameId: frameId, diff: href });
    var issueList = $(this).closest('.issue-list');
    var diffColumns = issueList.data().diffColumns;
    var html = $(this).html().trim();
    var columnId = 'rb-column' + html;
    $(this).addClass(columnId);
    $(this).data({ columnId: columnId});
    // For columnId == 'rb-columnView' the button is installed above.
    if (columnId != 'rb-columnView') {
      var cell = $(this).closest('.issue-list').find('.rb-deltaHeader');
      addShowButton(cell, columnId, 'All ' + html);
    }
  })

  $('.issue-list a[href*="/patch/"]:not(.rb-filename)')
    .addClass('rb-filename')
    .each(function() {
      var href = this.href;
      var diffHref = href.substr(0, href.lastIndexOf('/') + 1).replace('patch', 'diff') + this.innerHTML.trim();
      var rowId = $(this).data().rowId;
      var frameId = rowId + frameIdSuffixFromDiffHref(diffHref);
      $(this).data({ patch: href, diff: diffHref, frameId: frameId });
    });
}

function setupPatchSetObserver() {
  // TODO: These observers are only needed to detect the loading of patch set
  // data, we should be able to disconnect them from each patch set after its
  // loaded.
  var observer = new WebKitMutationObserver(function() {
    injectDataAndNodes();
    updatePatchTables();
  });
  $('div[id^=ps-]').each(function () { observer.observe(this, { childList: true }); });
}
setupPatchSetObserver();
injectDataAndNodes();
updatePatchTables();

// The baseurl is often long and makes the whole left pane too long... hide it.
function hideBaseUrl() {
  chrome.storage.sync.get('hideBaseUrl', function(items) {
    if (items['hideBaseUrl']) {
      $('.issue_details_sidebar').children().eq(4).hide();
      $('.meta').attr('width', '10%');
    } else {
      if ($('.meta').attr('width')[0] == '10%') {
        $('.meta').attr('width', '20%');
      }
      $('.issue_details_sidebar').children().eq(4).show();
    }
  });
}
hideBaseUrl();
chrome.storage.onChanged.addListener(function(changes, namespace) {
  hideBaseUrl();
}, 'hideBaseUrl');


function enableAnimations() {
  chrome.storage.sync.get('enableAnimations', function(items) {
    $.fx.off = !items['enableAnimations'];
  });
}
enableAnimations();
chrome.storage.onChanged.addListener(function(changes, namespace) {
  enableAnimations();
}, 'enableAnimations');
