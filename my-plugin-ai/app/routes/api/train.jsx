// // This file will download historical training data 
// // and call the AI training service (ai-logic.js)

// import { unauthenticated } from "../shopify.server";
// import prisma from "../db.server";
// import { trainModel } from "../ai-logic";

// export const action = async ({ request }) => {
//     const headers = {
//         "Content-Type": "application/json"
//     };

//     try {
//         const url = new URL(request.url);
//         let shop = url.searchParams.get("shop");

//         console.log("Shop in Backend:", shop);

//         if (!shop || shop === "undefined" || shop === "null") {
//             return new Response(JSON.stringify({ error: "Missing shop param" }), {
//                 status: 400,
//                 headers
//             });
//         }


//         console.log(`Starting AI training for shop ${shop}...`);

//         // 1. Get historical orders data from Shopify API
//         // first 50 orders to see and test
//         const { admin } = await unauthenticated.admin(request, shop);

//         const response = await admin.graphql(`{
//             orders(first: 50, query: "fulfillment_status:fulfilled") {
//                 edges {
//                     node {
//                         lineItems(first: 20) {
//                             edges { node { product { id } } }
//                         }
//                     }
//                 }
//             }
//         }`);

//         const responseJson = await response.json();

//         if (responseJson.errors) {
//             throw new Error("GraphQL Errors: " + JSON.stringify(responseJson.errors));
//         }
//         // Test response:
//         console.log("ResponseJson:", JSON.stringify(responseJson));

//         const orders = responseJson.data.orders.edges.map(e => e.node);

//         if (orders.length === 0) {
//             return new Response(JSON.stringify({ success: true, rules_learned: 0, message: "No historical orders to learn."}), {
//                 headers
//             });
//         }

//         // 2. Call AI training function:
//         const newRules = trainModel(orders);
//         console.log(`Trained model with ${newRules.length} rules from ${orders.length} orders`);

//         // 3. Save trained model to database (prisma)
//         // we will use upsert to update existing or create new
//         // but later
//         await prisma.recommendationRule.deleteMany({});

//         if (newRules.length > 0) {
//             await prisma.recommendationRule.createMany({ data: newRules });
//         }

//         // Return JSON response:
//         return new Response(JSON.stringify({
//             success: true,
//             rules_learned: newRules.length
//         }), { headers });

//     } catch (error) {
//         console.error("Erorr Training: ", error);
//         return new Response(JSON.stringify({ 
//             error: error.message
//         }), {
//             status: 500,
//             headers
//         });
//     } 
// };
// app/routes/api/train.jsx
// app/routes/api/train.jsx
import { authenticate } from "../../shopify.server";
import prisma from "../../db.server";
import { trainModel } from "../../ai-logic";

export const action = async ({ request }) => {
  const headers = { "Content-Type": "application/json" };

  try {
    const { session, admin } = await authenticate.admin(request);
    const shop = session.shop;

    console.log("✅ SHOP:", shop);

    // get orders from Shopify
    const response = await admin.graphql(`
      {
        orders(first: 50, query: "fulfillment_status:fulfilled") {
          edges {
            node {
              lineItems(first: 20) {
                edges {
                  node {
                    product { id }
                  }
                }
              }
            }
          }
        }
      }
    `);

    const result = await response.json();
    const orders = result.data.orders.edges.map(e => e.node);

    // Train AI
    const rules = trainModel(orders);

    await prisma.recommendationRule.deleteMany();
    if (rules.length > 0) {
      await prisma.recommendationRule.createMany({ data: rules });
    }

    return new Response(
      JSON.stringify({ success: true, rules_learned: rules.length }),
      { headers }
    );

  } catch (err) {
    console.error(" TRAIN ERRORRRR:", err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers }
    );
  }
};
