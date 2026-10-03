const products = [
  {id:"studio-headphones",name:"Studio Headphones",category:"Audio",detail:"Wireless · Noise cancelling",price:189,oldPrice:229,rating:"4.9",reviews:128,badge:"Jamal’s pick",image:"https://images.unsplash.com/photo-1505740420928-5e560c06d30e?auto=format&fit=crop&w=850&q=85",tone:"#e9ded1"},
  {id:"everyday-watch",name:"Everyday Watch",category:"Wearables",detail:"AMOLED · 7-day battery",price:149,rating:"4.8",reviews:94,badge:"Best seller",image:"https://images.unsplash.com/photo-1523275335684-37898b6baf30?auto=format&fit=crop&w=850&q=85",tone:"#e7ece9"},
  {id:"pocket-speaker",name:"Pocket Speaker",category:"Audio",detail:"360° sound · Water resistant",price:79,rating:"4.8",reviews:76,badge:"Small but mighty",image:"https://images.unsplash.com/photo-1608043152269-423dbba4e7e1?auto=format&fit=crop&w=850&q=85",tone:"#e5e8e4"},
  {id:"phone-stand",name:"Magnetic Phone Stand",category:"Accessories",detail:"Aluminum · Folds flat",price:34,rating:"4.7",reviews:51,badge:"Desk favorite",image:"https://images.unsplash.com/photo-1586953208448-b95a79798f07?auto=format&fit=crop&w=850&q=85",tone:"#ece9e4"},
  {id:"smart-watch",name:"Active Smartwatch",category:"Wearables",detail:"Fitness tracking · GPS",price:219,oldPrice:249,rating:"4.9",reviews:112,badge:"New arrival",image:"https://images.unsplash.com/photo-1508685096489-7aacd43bd3b1?auto=format&fit=crop&w=850&q=85",tone:"#e5e7e3"},
  {id:"earbuds",name:"Daily Earbuds",category:"Audio",detail:"Pocket case · 30-hour play",price:99,rating:"4.8",reviews:88,badge:"On the go",image:"https://images.unsplash.com/photo-1606220945770-b5b6c2c55bf1?auto=format&fit=crop&w=850&q=85",tone:"#eae9e4"},
  {id:"desk-lamp",name:"Glow Desk Light",category:"Accessories",detail:"Dimmable · USB-C powered",price:58,rating:"4.7",reviews:43,badge:"Better evenings",image:"https://images.unsplash.com/photo-1507473885765-e6ed057f782c?auto=format&fit=crop&w=850&q=85",tone:"#ece6dc"},
  {id:"travel-charger",name:"Travel Charger Kit",category:"Accessories",detail:"65W · 3-device charging",price:49,rating:"4.9",reviews:63,badge:"Travel ready",image:"https://images.unsplash.com/photo-1609592806596-b43bada0f2d3?auto=format&fit=crop&w=850&q=85",tone:"#e4eae7"},
];
const cart = new Map();
const favorites = new Set();
let currentUser = null;
let activeCategory = "All";
let searchTerm = "";
let toastTimer;
const grid = document.querySelector("#product-grid");
const emptyResults = document.querySelector("#empty-results");
const cartDrawer = document.querySelector("#cart-drawer");
const overlay = document.querySelector("#overlay");

function productCard(product) {
  const favorite = favorites.has(product.id);
  return `<article class="product-card"><div class="product-art" style="background:${product.tone}"><img src="${product.image}" alt="${product.name}" loading="lazy"><span class="product-badge">${product.badge}</span><button class="product-favorite ${favorite ? "is-favorite" : ""}" data-favorite="${product.id}" aria-label="${favorite ? "Remove" : "Add"} ${product.name} ${favorite ? "from" : "to"} favorites" aria-pressed="${favorite}">${favorite ? "♥" : "♡"}</button><button class="product-add" data-add="${product.id}">Add to bag <span>+</span></button></div><div class="product-info"><div class="product-topline"><h3 class="product-name">${product.name}</h3><div class="product-rating">★ <span>${product.rating} (${product.reviews})</span></div></div><div class="product-meta">${product.detail}</div><div class="product-price">$${product.price}${product.oldPrice ? ` <del>$${product.oldPrice}</del>` : ""}</div></div></article>`;
}
function renderProducts() {
  const filtered = products.filter((product) => (activeCategory === "All" || product.category === activeCategory) && `${product.name} ${product.category} ${product.detail}`.toLowerCase().includes(searchTerm.toLowerCase()));
  grid.innerHTML = filtered.map(productCard).join("");
  emptyResults.hidden = filtered.length > 0;
  grid.hidden = filtered.length === 0;
}
const money = (amount) => `$${amount.toFixed(2)}`;
const cartQuantity = () => [...cart.values()].reduce((total, item) => total + item.quantity, 0);
const cartSubtotal = () => [...cart.values()].reduce((total, item) => total + item.product.price * item.quantity, 0);

function renderCart() {
  const quantity = cartQuantity();
  const subtotal = cartSubtotal();
  document.querySelector("[data-cart-count]").textContent = quantity;
  document.querySelector("[data-cart-title-count]").textContent = `(${quantity})`;
  const content = document.querySelector("#cart-content");
  const footer = document.querySelector("#cart-footer");
  if (!quantity) {
    content.innerHTML = `<div class="cart-empty"><span>♧</span><h3>Your bag is taking a breather.</h3><p>There’s some good gear waiting for you.</p><button class="button dark" data-close-cart>Explore the shop <span>↗</span></button></div>`;
    footer.innerHTML = "";
    return;
  }
  content.innerHTML = [...cart.values()].map(({product,quantity:count}) => `<div class="cart-line"><div class="cart-line-image"><img src="${product.image}" alt=""></div><div class="cart-line-info"><strong>${product.name}</strong><small>${product.detail}</small><div class="quantity-control"><button data-quantity="${product.id}" data-delta="-1" aria-label="Remove one ${product.name}">−</button><span>${count}</span><button data-quantity="${product.id}" data-delta="1" aria-label="Add one ${product.name}">+</button></div></div><div class="cart-line-info" style="align-items:flex-end"><span class="cart-line-price">${money(product.price*count)}</span><button class="remove-item" data-remove="${product.id}">Remove</button></div></div>`).join("");
  const remaining = Math.max(100 - subtotal, 0);
  footer.innerHTML = `<div class="shipping-progress">${remaining ? `You’re ${money(remaining)} away from free shipping` : "You’ve unlocked free shipping — nice."}<div class="shipping-track"><span style="width:${Math.min(subtotal,100)}%"></span></div></div><div class="subtotal-row"><span>Subtotal</span><span>${money(subtotal)}</span></div><div class="tax-note">Shipping and taxes calculated at checkout.</div><button class="button dark checkout-button" data-checkout>Continue to checkout <span>↗</span></button><button class="continue-shopping" data-close-cart>Keep looking around</button>`;
}
function showToast(message) {
  const toast = document.querySelector("#toast");
  document.querySelector("#toast-message").textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2500);
}
function openCart() {
  renderCart(); overlay.hidden = false;
  requestAnimationFrame(() => { overlay.classList.add("show"); cartDrawer.classList.add("open"); });
  cartDrawer.setAttribute("aria-hidden", "false"); document.body.classList.add("no-scroll");
  document.querySelector(".close-cart").focus();
}
function closeCart() {
  overlay.classList.remove("show"); cartDrawer.classList.remove("open");
  cartDrawer.setAttribute("aria-hidden", "true"); document.body.classList.remove("no-scroll");
  setTimeout(() => { if (!cartDrawer.classList.contains("open")) overlay.hidden = true; }, 250);
}
function setCategory(category) {
  activeCategory = category;
  document.querySelectorAll(".category-tabs button").forEach((button) => {
    const selected = button.dataset.category === category;
    button.classList.toggle("active", selected); button.setAttribute("aria-selected", String(selected));
  });
  renderProducts();
  document.querySelector("#products").scrollIntoView({behavior:"smooth",block:"start"});
}
function showView(view) {
  const showShop = view === "shop";
  document.querySelector("#shop-view").hidden = !showShop;
  document.querySelector("#auth-view").hidden = showShop;
  document.querySelector(".site-footer").hidden = !showShop;
  document.querySelector(".desktop-nav").classList.remove("mobile-open");
  document.querySelector(".mobile-menu").setAttribute("aria-expanded","false");
  window.scrollTo({top:0,behavior:"smooth"});
  if (!showShop) document.querySelector("#login-email").focus({preventScroll:true});
}
function updateAccountButton() {
  const button = document.querySelector(".account-button");
  const label = document.querySelector("#account-label");
  label.textContent = currentUser ? (currentUser.name.split(/\s+/)[0] || "Account") : "Sign in";
  button.setAttribute("aria-label", currentUser ? `Sign out ${currentUser.name}` : "Sign in with Google");
  button.title = currentUser ? `Signed in as ${currentUser.email}. Click to sign out.` : "Sign in with Google";
}
async function loadAuthSession() {
  try {
    const response = await fetch("/api/session", {credentials:"same-origin",cache:"no-store"});
    if (response.ok) {
      const data = await response.json();
      currentUser = data.authenticated ? data.user : null;
      updateAccountButton();
    }
  } catch {
    // The storefront still works when opened without the Node auth server.
  }
  const result = new URLSearchParams(window.location.search).get("auth");
  if (result) {
    showToast(result === "success" ? `Welcome, ${currentUser?.name || "you're signed in"}.` : result === "cancelled" ? "Google sign-in was cancelled." : "Google sign-in could not be completed.");
    const cleanUrl = new URL(window.location.href);
    cleanUrl.searchParams.delete("auth");
    window.history.replaceState({}, "", cleanUrl.pathname + cleanUrl.search + cleanUrl.hash);
  }
}
async function signOut() {
  try {
    const response = await fetch("/auth/logout", {method:"POST",credentials:"same-origin"});
    if (!response.ok) throw new Error("Sign-out failed");
    currentUser = null;
    updateAccountButton();
    showToast("You’ve signed out.");
  } catch {
    showToast("Couldn’t reach the sign-in server. Try again.");
  }
}

document.addEventListener("click", (event) => {
  const add = event.target.closest("[data-add]");
  if (add) { const product=products.find((item)=>item.id===add.dataset.add); const current=cart.get(product.id); cart.set(product.id,{product,quantity:(current?.quantity||0)+1}); renderCart(); showToast(`${product.name} added to your bag`); return; }
  const favorite = event.target.closest("[data-favorite]");
  if (favorite) { const id=favorite.dataset.favorite; favorites.has(id)?favorites.delete(id):favorites.add(id); renderProducts(); showToast(favorites.has(id)?"Saved to your favorites":"Removed from your favorites"); return; }
  const change = event.target.closest("[data-quantity]");
  if (change) { const id=change.dataset.quantity; const item=cart.get(id); const next=item.quantity+Number(change.dataset.delta); if(next<1)cart.delete(id);else cart.set(id,{...item,quantity:next}); renderCart(); return; }
  const remove = event.target.closest("[data-remove]");
  if (remove) { cart.delete(remove.dataset.remove); renderCart(); return; }
  const categoryLink = event.target.closest("[data-category-link]");
  if (categoryLink) { event.preventDefault(); const category=categoryLink.dataset.categoryLink; if(["All","Audio","Wearables","Accessories"].includes(category))setCategory(category); return; }
  if (event.target.closest("[data-open-cart]")) { openCart(); return; }
  if (event.target.closest("[data-close-cart]")) { closeCart(); return; }
  if (event.target.closest("[data-open-auth]")) { currentUser ? signOut() : showView("auth"); return; }
  const viewLink=event.target.closest("[data-view]");
  if(viewLink){event.preventDefault();showView(viewLink.dataset.view);return;}
  if(event.target.closest("[data-checkout]")){showToast("Checkout is a UI demo — your bag is saved here.");return;}
  if(event.target.closest("[data-reset-filters]")){activeCategory="All";searchTerm="";document.querySelector("#product-search").value="";document.querySelector('.category-tabs button[data-category="All"]').click();}
});
document.querySelectorAll(".category-tabs button").forEach((button)=>button.addEventListener("click",()=>setCategory(button.dataset.category)));
document.querySelector("#product-search").addEventListener("input",(event)=>{searchTerm=event.target.value.trim();renderProducts();});
document.querySelector(".search-toggle").addEventListener("click",()=>{document.querySelector("#product-search").focus();document.querySelector("#products").scrollIntoView({behavior:"smooth"});});
overlay.addEventListener("click",closeCart);
document.querySelector(".mobile-menu").addEventListener("click",(event)=>{const nav=document.querySelector(".desktop-nav");const expanded=event.currentTarget.getAttribute("aria-expanded")==="true";event.currentTarget.setAttribute("aria-expanded",String(!expanded));nav.classList.toggle("mobile-open",!expanded);});
document.querySelector("#google-signin").addEventListener("click",()=>{window.location.assign("/auth/google");});
document.querySelector("#login-form").addEventListener("submit",(event)=>{event.preventDefault();showToast("Sign-in is a UI demo — no account is connected.");});
document.querySelector("#forgot-password").addEventListener("click",(event)=>{event.preventDefault();showToast("Password reset is not connected in this demo.");});
document.querySelector("#create-account").addEventListener("click",()=>showToast("Account creation is not connected in this demo."));
document.querySelector("#toggle-password").addEventListener("click",(event)=>{const input=document.querySelector("#login-password");const show=input.type==="password";input.type=show?"text":"password";event.currentTarget.setAttribute("aria-label",show?"Hide password":"Show password");});
document.querySelector("#newsletter-form").addEventListener("submit",(event)=>{event.preventDefault();event.currentTarget.reset();showToast("You’re on the list. Welcome in.");});
document.addEventListener("keydown",(event)=>{if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==="k"){event.preventDefault();showView("shop");document.querySelector("#product-search").focus();document.querySelector("#products").scrollIntoView({behavior:"smooth"});}if(event.key==="Escape"&&cartDrawer.classList.contains("open"))closeCart();});
renderProducts(); renderCart(); loadAuthSession();
