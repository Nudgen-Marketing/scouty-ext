/* global sessionStorage */
// SYNTHETIC page behaviour for the mock LinkedIn server. It plays the part of the page's own
// scripts: it shows the rest of a text when "… more" is pressed, loads more items while showing a
// loader (as LinkedIn's server-driven pages do when scrolled), and can turn into a checkpoint. It also keeps a log of EVERY click on the page, which the e2e suite
// reads to prove the extension pressed nothing but the expand and load-more controls.
(function () {
  var KEY = "__mock_clicks";
  function log(entry) {
    var all = JSON.parse(sessionStorage.getItem(KEY) || "[]");
    all.push(entry);
    sessionStorage.setItem(KEY, JSON.stringify(all));
  }
  document.addEventListener("click", function (event) {
    var el = event.target;
    var box = el.closest("[data-testid='expandable-text-box']");
    log({ tag: el.tagName.toLowerCase(), cls: el.getAttribute("class") || "", testid: el.getAttribute("data-testid") || "", hidden: el.getAttribute("aria-hidden") || "", inBox: !!box, text: (el.textContent || "").trim().slice(0, 40), path: location.pathname, trusted: event.isTrusted });
    if (el.matches("button[data-testid='expandable-text-button']") && box) {
      var rest = box.querySelector("[data-rest]");
      if (rest) rest.removeAttribute("hidden");
      el.remove();
    }
    if (el.matches("button.scaffold-finite-scroll__load-button")) el.remove();
  }, true);

  var body = document.body;
  var lazyTotal = Number(body.getAttribute("data-lazy-total") || 0);
  var lazyStep = Number(body.getAttribute("data-lazy-step") || 0);
  var checkpointAfter = Number(body.getAttribute("data-checkpoint-after") || 0);
  var scrolls = 0;
  var made = 0;
  var pending = false;
  function addItem(n) {
    var list = document.querySelector("main#workspace [role='list'][data-component-type='LazyColumn']");
    if (!list) return;
    var item = document.createElement("div");
    item.setAttribute("role", "listitem");
    item.setAttribute("componentkey", "synthetic-lazy-" + n);
    var box = document.createElement("span");
    box.setAttribute("data-testid", "expandable-text-box");
    box.textContent = "Synthetic lazy post number " + n + ".";
    var link = document.createElement("a");
    link.setAttribute("href", "/feed/update/urn:li:activity:71303168000000" + String(10000 + n) + "/");
    link.textContent = "View post";
    item.appendChild(box);
    item.appendChild(link);
    list.appendChild(item);
  }
  // Like LinkedIn: a loader shows for a moment, then the next items arrive.
  function loadSome() {
    if (pending || made >= lazyTotal) return;
    pending = true;
    var loader = document.createElement("div");
    loader.setAttribute("data-testid", "loader");
    loader.textContent = "Loading";
    document.querySelector("main#workspace").appendChild(loader);
    setTimeout(function () {
      for (var i = 0; i < lazyStep && made < lazyTotal; i += 1) {
        made += 1;
        addItem(made);
      }
      loader.remove();
      pending = false;
    }, 300);
  }
  window.addEventListener("scroll", function () {
    scrolls += 1;
    if (checkpointAfter && scrolls === checkpointAfter) {
      var captcha = document.createElement("div");
      captcha.id = "captcha-internal";
      captcha.textContent = "Synthetic security check";
      document.body.appendChild(captcha);
    }
    loadSome();
  });
})();
