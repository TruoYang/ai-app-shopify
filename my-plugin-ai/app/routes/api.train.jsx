// API to train recommendation model from orders in database

import { authenticate, unauthenticated } from "../shopify.server";
import { runTraining } from "../training.server";

export const action = async ({ request }) => {
  let shop = null;
  let admin = null;
  let authState = "unknown";
  let authError = null;
  const url = new URL(request.url);
  const shopParam = url.searchParams.get("shop");
  // The ?shop fallback below lets local testing work when the embedded session
  // token is missing. It is never trusted in production.
  const allowShopParam = process.env.NODE_ENV !== "production";

  try {
    // Authenticate admin
    const authResult = await authenticate.admin(request);
    
    // if Response redirect, break
    if (!(authResult instanceof Response)) {
      shop = authResult.session.shop;
      admin = authResult.admin;
      authState = "authenticated";
      console.log("Authenticated shop:", shop);
    } else {
      authState = "redirect";
      console.log("Auth returned redirect, will try unauthenticated admin if possible");
    }
  } catch (authErr) {
    if (authErr instanceof Response) {
      authState = "redirect";
      console.log("Auth returned redirect, will try unauthenticated admin if possible");
    } else {
      authState = "error";
      authError = authErr?.message || String(authErr);
      console.log("Auth failed, will try unauthenticated admin if possible:", authErr.message);
    }
  }

  let adminForSync = admin;

  if (!adminForSync && shopParam && allowShopParam) {
    try {
      const unauth = await unauthenticated.admin(shopParam);
      adminForSync = unauth.admin;
      shop = shopParam;
      authState = "unauthenticated";
    } catch (unauthErr) {
      authState = "unauthenticated-error";
      authError = unauthErr?.message || String(unauthErr);
    }
  }

  if (!shop) {
    return Response.json(
      { success: false, error: "Session expired. Please reload the app and try again.", authError },
      { status: 401 },
    );
  }

  return runTraining({ shop, adminForSync, authState, authError });
};