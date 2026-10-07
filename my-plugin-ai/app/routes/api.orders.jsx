// API to get orders from Shopify
// Don't use anymore, replaced by api.train.jsx
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);

  const query = `
    {
      orders(first: 5, sortKey: CREATED_AT, reverse: true) {
        edges {
          node {
            id
            name
            lineItems(first: 10) {
              edges {
                node {
                  product {
                    id
                  }
                  name
                  quantity
                }
              }
            }
          }
        }
      }
    }
  `;

  try {
    const response = await admin.graphql(query);
    const data = await response.json(); // Get JSON data

    //
    // Check if Shopify returned errors in the JSON response
    if (data.errors) {
      console.error("ERROR returns from GRAPHQL:", JSON.stringify(data.errors, null, 2));
      
      // If errors return message 500
      return new Response(JSON.stringify({ error: data.errors[0].message }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
    

    // If no error return orders data
    return new Response(JSON.stringify({ orders: data.data.orders.edges }), {
      headers: { "Content-Type": "application/json" },
    });

  } catch (error) {
    // Server or network erorr
    console.error("Server error (catch block):", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};