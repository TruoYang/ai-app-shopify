===== PAGE 1 =====
HANOI UNIVERSITY OF SCIENCE AND TECHNOLOGY
SCHOOL OF INFORMATION AND COMMUNICATIONS TECHNOLOGY
GRADUATION RESEARCH II
Report
Building Shopify App
for Product Suggestions
Instructor:Dr. Bui Trong Tung
Major:Information Technology – Global ICT
Student:Nguyen Dang Truong Giang
Hanoi, January 2026

===== PAGE 2 =====
Contents
Ackowledgements 2
Preface 3
List of Abbreviations 4
1 Introduction - Problem Statement 5
1.1 Background and Motivation . . . . . . . . . . . . . . . . . . . . . . . . . . . 5
1.2 Problems to Solve . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . 5
1.3 Project Goals . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . 5
1.4 Technology Choosing . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . 5
2 System Design and Implementation 8
2.1 System Scope and User Flows . . . . . . . . . . . . . . . . . . . . . . . . . . 8
2.2 Functional Requirements . . . . . . . . . . . . . . . . . . . . . . . . . . . . . 8
2.3 Non-Functional Requirements (NFRs) . . . . . . . . . . . . . . . . . . . . . . 9
2.4 High-Level Architecture . . . . . . . . . . . . . . . . . . . . . . . . . . . . . 9
2.5 Shopify Integration Design . . . . . . . . . . . . . . . . . . . . . . . . . . . . 10
2.6 Training Pipeline Design . . . . . . . . . . . . . . . . . . . . . . . . . . . . . 12
2.7 Recommendation Service Design . . . . . . . . . . . . . . . . . . . . . . . . . 16
2.8 Backend Implementation Details . . . . . . . . . . . . . . . . . . . . . . . . . 18
2.9 Database Schema and ERD . . . . . . . . . . . . . . . . . . . . . . . . . . . . 20
2.10 Security and Privacy Design . . . . . . . . . . . . . . . . . . . . . . . . . . . 22
2.11 Performance, Scalability and Optimization . . . . . . . . . . . . . . . . . . . . 23
2.12 Error Handling and Observability . . . . . . . . . . . . . . . . . . . . . . . . 24
2.13 Development Environment (Local) and Cloudflare Tunnel . . . . . . . . . . . 24
2.14 Production Deployment Plan . . . . . . . . . . . . . . . . . . . . . . . . . . . 25
2.15 UI/UX Design . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . 26
2.16 Testing and Validation Strategy . . . . . . . . . . . . . . . . . . . . . . . . . . 26
2.17 Chapter Summary . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . 27
3 Development and Experimental Results 28
3.1 Experimental Setup . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . 28
3.2 Sample Input Orders . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . 28
3.3 Example Learned Rules . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . 28
3.4 Recommendation Test Cases . . . . . . . . . . . . . . . . . . . . . . . . . . . 28
3.5 Discussion . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . 28
4 Conclusion and Future Developing 29
4.1 Achievements . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . 29
4.2 Skills Gained . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . 29
4.3 Future Improvements . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . 29
1

===== PAGE 3 =====
ACKNOWLEDGEMENTS
First and foremost, I would like to express my sincere gratitude to the Board of Management
of SOICT - HUST and the lecturers of the Faculty of ICT for equipping me with valuable
foundational knowledge throughout my academic journey.
I am deeply indebted to my supervisor,Dr. Bui Trong Tungfor his dedicated guidance
and support. His insightful feedback and expertise were instrumental in helping me navigate
the technical challenges of building Shopify application, from optimizing the Association Rule
algorithm to handing system integration issues.
Despite my best efforts, this report may contain inevitable shortcomings due to lack of
practical experience, I indeed welcome any constructive comments and suggestions from the
lecturers to further improve this project in the future.
Sincerely.
Hanoi, 8 January, 2026
Giang
Nguyen Dang Truong Giang
2

===== PAGE 4 =====
PREFACE
In the digital age, e-commerce is developing robustly, becoming an indispensable component
of the global economy. Beyond merely attracting new customers, optimizingAverage Order
Value (AOV)is a critical challenge for retail businesses. One of the most effective solutions
to address this is the implementation of aProduct Recommendation System. Howerver, for
small and medium-sized merchants on the Shopify platform, accessing complex AI systems often
presents significant barriers regarding cost and implementation capability.
Addressing this practical need, this report presents the development process of"my-plugin-ai"
- a Shopify application designed to automate product recommendations based on historical
purchased order data.
Problem Statement and SolutionThe core objective of this project is to build a closed-loop
system serving two primary stakeholders: theMerchantandShop Owner.
Algorithmic Foundation:System operates based on Association Rule Learning: The
probability of product B exists given that a customer has selected product A.
Technology Platform and Development Tools:The application is developed and tested in a
local environment, designed withScalabilityfor future Production deployment in mind:
•Platform:Shopify App (Embedded).
• Network Communication:UtilizesShopify CLIcombined with aCloudflare Tunnel
to establish a secure intermediate gateway. This allows the local application to maintain
bi-directional communication (receiving Webhooks, consuming APIs) with Shopify
servers.
• Database:EmploysPrisma ORMto manage the data schema and execute queries for
storing recommendation rules (including Pair IDs, SKUs, cart activation conditions and
recommended products).
SUMMARY OF REPORT CONTENTS
The report is organized into chapters with specific contents as follows:
• Chapter 1 - Problem Analysis and Solution Orientation:Presents the rationale for
selecting the topic, research objectives and the scope of the "my-plugin-ai" application
within the e-commerce ecosystem.
• Chapter 2 - Theoretical Basis & System Design:Presents the comprehensive process
of system construction. This chapter details the architectural design, logic processing,
functional implementation (for both merchant and shopper workflows), system optimization,
and the technical integration between Shopify, Cloudflare, and the local server.
• Chapter 3 - Development and Experimental Implementation:Details the construction
process of functional modules: the Data Training module, the Storage module ad the
Recommendation API module via URL.
• Chapter 4 - Conclusion:Summarizes the project’s achievements, key knowledge acquired
during the course, and outlines potential directions for future system enhancements..
3

===== PAGE 5 =====
List of Abbreviations
Admin API Shopify Admin API (GraphQL)
App Shopify App (Embedded)
AOV Average Order Value
CORS Cross-Origin Resource Sharing
DB Database
CSV Comma-Separated Values
Dev tunnel An intermediate URL generated by Shopify CLI (or Cloudflare)
when runningshopify app dev
GID Shopify Global ID, formatted asgid://shopify/Product/...
ORM Object-Relation Mapping
UI User Interface
UX User Experiment
POC Proof of Concept
SKU Stock Keeping Unit (Product’s ID/ Product Variation’s ID)
SSR Server-Side Rendering
Glossary of Terms
• Association Rule: A directional rule A → B meaning B tends to occur when A occurs,
quantified using support, confidence and optionally lift.
• Support: Frequency of an itemset in transactions: support(AB) = count(AB)
N .N is number
of all orders.
•Confidence: Conditional probability:con f idence(A→B) =P(B|A) = support(AB)
support(A) .
•Lift: Confidence normalized by popularity of B:li f t(A→B) = con f idence(A→B)
support(B) .
• Training Run (future improvement): A single execution of training that produces a rule set saved to the database.
• App Proxy (optional hardening): Shopify mechanism to call app endpoints through the shop domain, enabling signed requests (HMAC).
4

===== PAGE 6 =====
1 Introduction - Problem Statement
1.1 Background and Motivation
In the digital age, websites and e-commerce have become indispensable to daily life. Globally,
it is estimated that 2.71 billion people — roughly 33% of the world’s population — participate in
online shopping, with many making purchases on a weekly basis. Daily expenditure varies by
region, for instance, in Vietnam, consumers spend approximately US $32 – $35 million per day
on major platforms, primarily in categories such as electronics, fashion, and food. Given this
immense transaction volume, product recommendation systems play a pivotal role. Specifically,
the presence of a recommendation engine can increase the likelihood of a user making an
additional purchase by 30%, even if the recommended item itself is not selected.
1.2 Problems to Solve
The project addresses the following technical problems:
•Acquired historical orders from Shopify reliably while respecting API rate limits.
•Transform orders into a clean transaction dataset(SKU sets per order).
•Mine directional association rules and evaluate rule strength via confidence P(B|A).
•Persist learned rules and order history in a database using Prisma ORM (prototype overwrites rules per shop).
•Serve real-time recommendations to the storefront with a well-defined API contract.
•Provide a practical path from local development (tunnel) to production deployment.
1.3 Project Goals
• Embedded Shopify Admin UI with a "Train AI model" button and returning notice with
training status and number of association rules.
•Training pipeline that generates directed rules A -> B and saves them to the database.
•Recommendation endpoint that returns recommended SKU(s) given input SKU(s).
•Documented system architecture, database schema and deployment plan.
1.4 Technology Choosing
• Platform / External Service - Shopify:a managed SaaS e-commerce platform, which
is significantly reduces infrastructure, maintenance and system upgrade responsibilities.
Also, Shopify provides a complete application development ecosystem (OAuth authentication,
scope-based permissions, webhooks, Admin API and theme app extensions), enabling fast,
consistent and platform-compliant integration of product recommendation features into
the store.
•Frontend (Admin UI inside Shopify)
– React + React Router (Shopify app template):
5

===== PAGE 7 =====
◦Role:core library for building the embedded Single Page Application (SPA).
◦ Rationale:Facilitates a "page/action" model (E.g., separating Training and
Configuration views) with efficient client-side routing and state management.
– Shopify Polaris:
◦Role:Official UI component library.
◦ Rationale:Ensures the application complies with Shopify’s design guidelines
(Accessibility, UX) and provides a naive look and feel, significantly reducing UI
development time.
•Backend (Server & Business Logic)
– Node.js:
◦Role:Server-side runtime environment.
◦ Rationale:Selected for its non-blocking I/O architecture, making it highly
efficient for handling concurrent API requests and database operations. It also
shares the same language (JavaScript) with the frontend.
– File-based API Routing:
◦Role:API Architecture.
◦Rationale:distinct files for specific endpoints (e.g.,api.train.jsx,
api.recommend.jsx ensure a clean separation of concerns and simplified
testing.
•Database & Storage
– Prisma ORM:
◦Role:Object-Relational Mapping layer.
◦ Rationale:Provides type-safe database access and automated schema migrations.
It simplifies modeling complex relationships (E.g., linking Order History to
Recommendation Rules).
– SQLite (Development / POC)
◦Role:Relational Database Management System.
◦ Rationale:Lightweight and serverless, ideal for the initial development phase
and local testing. The use of Prisma allows for seamless migration to PostgreSQL
or MySQL in production.
•AI & Recommendation Logic
– Association Rule Learning (Apriori-based approach):
◦Role:Core recommendation algorithm.
◦ Rationale:chosen to solve the "Market Basket Analysis" problem. Unlike
"black-box" or "random forest" ML models, this approach offers transparent,
6

===== PAGE 8 =====
explainable results (Support / Confidence metrics) and is computationally
efficient for batch training.
•Platform Integration
– Shopify App SDK:
◦Role:Middle for authentication and context.
◦ Rationale:Handles OAuth handshakes, session token generation and ensures
secure communication between the embedded app and the Shopify Admin.
– Shopify Admin API (GraphQL):
◦Role:Data retrieval protocol.
◦ Rationale:Preferred over REST to prevent data over-fetching, allowing the
system to query only necessary fields (E.g., specific Order SKUs) to optimize
performance.
•Storefront Integration (User Facing)
– Shopify Theme App Extension:
◦Role:Client-side widget.
◦ Rationale:Allows the recommendation widget to be injected into the merchant’s
theme without modifying the theme’s source code directly.
– Fetch API:
◦Role:Asynchronous data transfer.
◦ Rationale:Used by the widget to send cart data to the backend and retrieve
recommendation results in real-time.
•Infrastructure & DevOps
– Shopify CLI & Cloudflare Tunnel:
◦Role:Local development gateway.
◦ Rationale:Creates a random URL tunnel to expose the local server to the public
internet, enabling the receipt of webhooks and API calls from Shopify during
development.
– Docker:
◦Role:Containerization.
◦ Rationale:Ensures consistency across development and production environments
by packaging the application and its dependencies into a single container. This
can be used to run project with production environment.
7

===== PAGE 9 =====
2 System Design and Implementation
2.1 System Scope and User Flows
The system is designed around two primary flows:
1. Training flow for shop owners: run data collection + rule mining and store results.
2. Recommendation flow for customers: receive SKU(s) from customer’s cart and return
corresponding recommended SKU(s).
Both flows share the same underlying rule dataset and must be consistent across environments
(dev and production)
2.1.1 Training Flow (Shop Manager
•Admin navigates to Apps/my-plugin-ai in Shopify Admin.
•UI displays a "Train AI model" button.
•Admin triggers training, backend fetches Shopify order history + relevant DB metadata.
•Backend mines association rules and persists them in database via Prisma.
•UI shows summary: orders processed, rules generated and warnings.
2.1.2 Recommendation Flow (Customer)
•When the cart contains products, the system (storefront) collects current SKU(s).
• Storefront sends a request to the app backend (direct URL from Theme App Extension) with sku/skus (and optional ids).
• Backend handles CORS, queries rules, ranks candidates, filters duplicates.
• Backend returns recommended SKU(s) with highest confidence and it’s confidence rate
for the storefront to render.
2.2 Functional Requirements
• FR-1: Provide an embedded Admin UI page and allow the admin to start getting shop data
and training.
•FR-2: Fetch order history from Shopify and process line items into SKU transactions.
• FR-3: Mine directional association rules and store them with metrics and activation
constraints (cartSize).
• FR-4: Expose a recommendation endpoint that returns recommended SKU(s) for given
input.
•FR-5: Support repeated training runs (prototype overwrites rules per shop; no rollback/versioning).
• FR-6: Provide meaningful logs and errors for both training and recommendation workflows.
8

===== PAGE 10 =====
2.3 Non-Functional Requirements (NFRs)
The system must satisfy multiple non-functional requirements that influence design decisions:
• Performance: recommendation endpoint should return results quickly (target < 500 ms
backend processing in local dev environment and 200 ms in production environment)
• Scalability: training should handle from hundreds to thousands of orders or more,
recommendation must handle concurrent customers.
• Reliability: training results should not corrupt active rules, failures should be recoverable
or at least removable.
•Security: ensure authenticated admin actions validate storefront calls and protect tokens.
• Maintainability: modular code organization, typed database access and clear API contracts.
• Extensibility: ability to add multi-item rules, incremental updates and more advanced
ranking or adding plus factor like gender/age into training...
2.4 High-Level Architecture
The application follows the standard Shopify embedded app architecture. The frontend
is embedded within Shopify Admin using App Bridge. The backend is a Node.js server that
implements OAuth, Shopify API calls, training logic, persistence via Prisma and recommendation
APIs.
A SQLite database stores sessions, order history and learned rules. In development, Shopify CLI provides a
public tunnel URL (Cloudflare) to route Shopify requests to the local backend.
2.4.1 Logical Architecture Diagram
Figure 1: Training AI Workflow
9

===== PAGE 11 =====
Figure 2: Recommend Product Workflow
2.5 Shopify Integration Design
2.5.1 OAuth Installation and Session Management
When a shop installs the app, Shopify initiates OAuth. The backend must:
1. Validate the shop domain.
2. Redirect to Shopify permission screen with required scopes.
3. Authenticate Shop owner’s information to Shopify for being allowed accessing shop data.
4. Exchange the authorization code for an access token.
5. Persist the token securely and associate it with the Shop record.
6. Establish a session for the embedded UI so the admin can access protected endpoints (E.g.
/api/train.
For security and maintainability, session management should be centralized in middle-ware
so all admin endpoints consistently enforce authentication.
2.5.2 Required Shopify Scopes
At minimum, the app requires read-only access to orders to build the training dataset. T ypical
scopes include:
•read_orders: read historical orders and line items.
• read_products (optional): map SKU to product/variation metadata for better storefront
rendering.
10

===== PAGE 12 =====
•read_inventory (optional): filter out-of-stock recommendations.
In the development environment, we have to do some authenticated process to confirm that
our collected shop data will be rightly used for its purposes.
2.5.3 Order Retrieval (GraphQL) and Pagination
Shopify returns orders through REST or GraphQL. For reliability, the app should use
cursor-based pagination (GraphQL) or page_info tokens (REST). In this project, I use GraphQL
for its preference over REST in preventing data over-fetching.
The training pipeline fetches orders in batches to avoid memory spikes and to respect rate
limits. Only the required fields are queried: order_id, createAt, lineItems (variant SKU) and
financial status.
2.5.4 Rate Limits and Throttling Strategy
Shopify enforces rate limits, therefore, the app must include throttling and retry logic. A
practical strategy is:
• Read rate limit headers (REST)or cost/throttle status (GraphQL) and sleep when near the
limit.
•Use exponential backoff on 429 responses or network timeouts.
• Cap maximum orders per training run (E.g. 5,000) and optionally train on a rolling time
window (E.g., last 90 days).
•Log API call count, pages fetched and total time for later diagnosis.
Scenario Symptom Mitigation
Near rate limit API responses slow or reject Sleep/retry using throttle info, reduce
page size
Network time Request fails mid-run Retry with exponential backoff, keep
cursor checkpoint
Large dataset Training time too long Limit time window, batch +
background jobs, incremental
updates
Table 1: Solving rate limit problem
2.5.5 Webhooks for Incremental Data
11

===== PAGE 13 =====
2.6 Training Pipeline Design
2.6.1 Pipelines Stages and Data Contracts
The training pipe line is implemented as a set of stages, each with clear input/output contracts
to simplify debugging and unit testing:
Stage Input Output Notes
S0 Validate Admin session +
params
Validated config Reject
unauthenticated calls
S1 Fetch orders Shop token +
window
Raw orders Pagination +
throttling
S2 Build transactions Raw orders Transactions (sets of
SKUs)
Data cleaning
S3 Count frequency Transactions countItem, countPair Pair enumeration
S4 Compute metrics Counters Rules with
support/confidence
Directional rules
S5 Persist results Rules + run metadata DB records Transactional writes
S6 Report summary Run results UI response Counts, time,
warnings
Table 2: Solving rate limit problem
2.6.2 Data Cleaning Rules (SKU Normalization
To achieve stable rules, the following cleaning rules are applied:
•Treat each order as a set of unique SKUs (ignore quantity for the baseline model).
•Remove line items without SKU (or map them to variantId as a fallback).
•Ignore orders with fewer than 2 unique SKUs when mining pair rules.
•Optionally ignore refunded/canceled/test orders depending on the business requirement.
• Optionally map SKUs to product groups if the store has many variants that share meaning.
•Skip orders with many SKUs to avoid unnecessary irrelevant sets.
2.6.3 Association Rule Mining Pair Rules
The baseline model mines pair rules only (A → B). Pair rules are effective for "accessory"
patterns and remain computationally cheap. The core idea is to count co-occurrence of items in
orders and convert counts to probabilities.
12

===== PAGE 14 =====
2.6.3.1 Metrics Definitions
Let N be the number of transactions.
•count(A): number of transactions containing A
•count(AB): number of transactions containing both A and B
•support(A) = count(AB)
N
•support(AB) = count(AB)
N
•con f idence(A→B) =P(B|A) = count(AB)
count(A)
Notice: confidence(A → B) is not generally equal to confidence(B → A), so this is not
reversible relationship.
2.6.3.2 Pseudocode
Input: transactions: List[Set[SKU]]
Parameters: minSupport, minConfidence
Output: rules: List[Rule]
countItem = Map[SKU, int] default 0
countPair = Map[(SKU, SKU), int] default 0 // unordered pairs
for T in transactions:
items = sorted(unique(T))
for i in range(len(items)):
countItem[items[i]] += 1
for j in range(i+1, len(items)):
pair = (items[i], items[j])
countPair[pair] += 1
N = len(transactions)
rules = []
for (x, y), cXY in countPair.items():
supportAB = cXY / N
if supportAB < minSupport: continue
confXtoY = cXY / countItem[x]
confYtoX = cXY / countItem[y]
if confXtoY >= minConfidence:
rules.append(Rule(antecedent=x, consequent=y,
support=supportAB, confidence=confXtoY))
if confYtoX >= minConfidence:
rules.append(Rule(antecedent=y, consequent=x,
13

===== PAGE 15 =====
support=supportAB, confidence=confYtoX))
return rules
2.6.4 Worked Example (End-to-End)
This subsection illustrates the training logic on a small dataset to demonstrate correctness and
clarify why direction is matter.
Order Items (SKUs)
O1 A, B
O2 A, B, C
O3 C, D
O4 B, C
O5 A, B
Table 3: Caption
Counts:
•count(A) = 3: O1, O2, O5
•count(B) = 4: O1, O2, O4, O5
•count(C) = 2: O2, O3, O4
•count(AB) = 3: O1, O2, O5
•count(BC) = 2: O2, O4
With N = 5, we can find that:
•support(AB) =3/5=0.6
•con f idence(A→B) = count(AB)
count(A) =3/3=1
•con f idence(B→A) = count(AB)
count(B =3/4=0.75
•con f idence(B→C) = count(BC)
count(B) =2/4=0.5
If minConfidence = 0.8, then A→B is stored, but B→A and B→C are filtered out
14

===== PAGE 16 =====
2.6.5 Training Parameters and Tuning
Training quality depends on parameter selection. In practice, thresholds should be configurable
per shop, because different shops have different order volumes and catalog sizes.
Parameter T ypical Range Effect Recommendation
minSupport 0.01 - 0.10 Filters rare pairs Use lower values when
order count is small
minConfidence 0.50 - 0.90 Controls rule strength Start at 0.60; increase
to reduce noise
timeWindowDays 30 - 365 Recency of orders Use 90 days for fast
iteration; increase for
stability
maxOrders 500 - 10,000 Caps training cost Set based on hosting
budget and API limits
maxRulesPerAntecedent 1 - 20 Controls output size Keep small for UI
simplicity (top 5)
Table 4: Recommended Hyperparameter Configuration
2.6.6 Job Execution Model: Synchronous vs Background
In a local prototype, training can run synchronously after clicking the button. In production,
long training can time out or block server resources.
In the current implementation, training runs synchronously inside the request (no background job, no runId/polling).
If the system is upgraded for production, a robust approach is to execute training as a background job
and return immediately with a runId. The UI can poll run status or use server-sent events.
•Synchronous (prototype): simplest, good for small dataset, risks request timeouts.
• Background job (production): uses a queue (E.g. BullMQ/Redis) or a worker process,
more reliable for large datasets.
• Concurrency control: allow only one RUNNING training job per shop to avoid inconsistent
rule versions.
2.6.7 Persistence and Versioning Strategy

In the current implementation, there is no TrainingRun/versioning. Rules are persisted by deleting existing rules for the shop and inserting fresh rules.
For a future production-grade version, it is recommended to add TrainingRun/versioning so that failed runs do
not replace active rules, and historical runs can be audited.
15

===== PAGE 17 =====
2.6.8 Data Storage Format for Rules
The prototype stores a JSON payload containing SKU pairs and additional fields (cartSize,
recommendedSku). For query performance and future extensions, it is recommended to store
explicit columns for antecedent SKU and consequent SKU, plus JSON for multi-item antecedents.
•antecedentSku: STRING (fast lookup for cartSize = 1).
•antecedentSet: JSON (future: multi-item antecedents).
•antecedentHash: STRING (computed) to index and uniquely identify antecedent sets.
•consequentSku: STRING (recommended item).
•confidence/support/lift: FLOAT metrics.
2.7 Recommendation Service Design
2.7.1 Recommendation API Options and Trade-offs
There are multiple ways to expose recommendations to the storefront. In the current
implementation of this project, the storefront uses a Theme App Extension that calls
the backend recommendation endpoint directly (cross-origin), and the backend enables
CORS for this purpose.

Option Pros Cons Best Use
App Proxy Signed requests, works under shop domain Setup required in Shopify Admin Most production storefronts (recommended hardening)
Theme extension calling backend Flexible UI blocks Works cross-origin; requires careful CORS/security Stores using Online Store 2.0 extensions (current implementation)
Direct backend call Simple technically Security + CORS complexity Internal testing only
Table 5: Comparison of Storefront Integration Approaches
16

===== PAGE 18 =====
2.7.2 Request Contract
The current recommendation endpoint is a GET route that accepts the shop domain and
cart identifiers. The storefront widget calls it as a direct URL (cross-origin).

Example:
GET /api/recommend?shop=<shop-domain>&ids=<productIds>&skus=<skus>

Where:
• shop: shop domain (e.g. my-shop.myshopify.com)
• ids: comma-separated Shopify product numeric IDs from /cart.js (optional)
• skus: comma-separated SKUs from /cart.js (preferred for matching rules)
Note: In the current implementation, cartSize and limit are not used as request parameters.
2.7.3 Response Contract (JSON example)
The current prototype returns a single best-matching recommendation (one product card)
or an informational message when no rule matches.

Success example:
{
  "product": {
    "id": "gid://shopify/Product/123...",
    "title": "Example Product",
    "image": "https://...",
    "price": "10.00",
    "currency": "USD",
    "url": "/products/example-handle",
    "variantId": "gid://shopify/ProductVariant/456...",
    "sku": "SKU-001"
  },
  "confidence": 0.75,
  "basedOn": ["SKU-A", "SKU-C"]
}

No-match example:
{
  "message": "No recommendation found for this cart"
}
2.7.4 Matching Logic (current prototype)
In the current implementation, the backend loads recommendation rules for the given shop,
sorts them by cartSize (desc) and confidence (desc), and returns the first rule that matches
the cart SKUs. The suggested SKU must not already be present in the cart.

2.7.5 Multi-item Matching (notes)
The current matching strategy is first-match. More advanced ranking (merging candidates,
top-N lists, lift, inventory filtering) can be implemented as future improvements.
2.7.6 Duplicate, Loop and Quality Filters
Real-world catalogs require filters to avoid low-quality recommendations:
•Filter duplicates: do not recommend an SKU that is already in the cart.
• Loop prevention: avoid A → B → A oscillations by only using one-step rules per request.
• Minimum confidence threshold at inference time (optional) to avoid returning weak rules.
• Inventory filter (optional): remove out-of-stock products if inventory scope is available
(can check at endpoint in embedded UI)
• Business rules (optional): exclude discontinued SKUs, low-margin items or restricted
products.
2.7.7 Storefront Rendering and SKU-to-Product Mapping
The recommendation endpoint returns SKUs. To display product cards, the storefront must
map SKU to product/variant.
Three approaches are common:
• Approach A: Store a ProductMap table (sku → productId/variantId/title/image). Training
or a separate sync job populates it.
•Approach B: Query Shopify Products API on demand (slower, requires more API calls).
• Approach C: Pass along variantId instead of SKU as the primary key (requires consistent
variant IDs).
In a prototype, Approach B is acceptable. For production performance, Approach A is recommended
to minimize storefront latency and API costs.
2.8 Backend Implementation Details
2.8.1 HTTP Route Layer
The backend exposes a small set of HTTP endpoints:

Endpoint Method Caller Purpose
/api/train POST Admin UI Trigger training (prototype)
/api.train POST Admin UI Alternative training endpoint (prototype/legacy)
/api/recommend GET Storefront Return a product recommendation for current cart
/webhooks/orders/paid POST Shopify Incremental update webhook (orders/paid)

Note: The current prototype does not implement a /api/train/:runId polling endpoint, and training
runs synchronously inside the request.
2.8.2 Middleware Stack
In this prototype, authentication and signature verification rely primarily on the Shopify
framework helpers:
• Admin routes: protected by embedded app authentication via authenticate.admin(request).
• Webhooks: validated via authenticate.webhook(request) (includes HMAC verification).
• Storefront endpoint (/api/recommend): uses explicit CORS headers for cross-origin calls.

Additional middleware such as schema validation, App Proxy HMAC validation, and rate limiting
are recommended for production hardening but are not fully implemented in this codebase.
2.8.3 Configuration Management
Configuration values are supplied via environment variables. In this project, the key
environment variables used are:
• SHOPIFY_API_KEY
• SHOPIFY_API_SECRET
• SCOPES (e.g. read_orders,write_products)
• SHOPIFY_APP_URL (application base URL)
• DATABASE_URL (SQLite in development)
• NODE_ENV (production/dev)

Values like ENCRYPTION_KEY and DEFAULT_MIN_CONFIDENCE/DEFAULT_MIN_SUPPORT are potential
future enhancements; the current implementation uses fixed defaults in code.
2.8.4 Prisma Usage Patterns
Prisma provides database access. In this project:
• Training persists rules by deleting existing rules for the shop and inserting fresh rules.
• Orders are stored in OrderHistory and used as training input.
• Upsert is used where a clear unique key exists (shop, orderId) for order history writes.

2.9 Database Schema and ERD
The current database schema (SQLite via Prisma) contains the following tables:

2.9.1 Entity Summary
• Session: stores Shopify session data for embedded admin authentication.
• RecommendationRule: stores learned association rules used for inference.
• OrderHistory: stores historical orders (CSV-imported and Shopify-synced) for training.

2.9.2 Session Table Fields
(See Prisma model Session)

2.9.3 RecommendationRule Table Fields
id INTEGER PK, Auto Increment
shop TEXT Not Null
cartProducts TEXT Not Null (JSON array)
cartSize INTEGER Not Null
suggestProduct TEXT Not Null
confidence REAL Not Null
support INTEGER Not Null
updatedAt DATETIME Not Null (Prisma @updatedAt)
Index: (shop, cartSize)

2.9.4 OrderHistory Table Fields
id INTEGER PK, Auto Increment
shop TEXT Not Null
orderId TEXT Not Null
productIds TEXT Not Null (JSON array; SKUs or GIDs depending on ingestion path)
source TEXT Not Null, Default 'shopify'
orderDate DATETIME Nullable
createdAt DATETIME Not Null, Default CURRENT_TIMESTAMP
Unique: (shop, orderId)
Index: (shop)

Note: A versioned TrainingRun/Rule schema and runId-based polling are not implemented in the
current codebase; they can be considered future improvements.

2.10 Security and Privacy Design
2.10.1 Admin Action Protection
Training is a privileged action. The backend must ensure the caller is an authenticated admin
session. Requests must include valid session tokens, and endpoints should reject unauthenticated
requests with clear error messages.
2.10.2 Webhook Signature Verification and Storefront Requests
Webhooks are validated using the Shopify library helper authenticate.webhook(request), which
includes HMAC verification for app-managed webhook subscriptions.

For storefront recommendation calls, this prototype currently uses direct cross-origin requests
from the Theme App Extension and relies on CORS. Using App Proxy (signed requests under the shop
domain) is recommended for production hardening but is not the default in the current implementation.
2.10.3 Token Storage and Data Minimization
•Encrypt access tokens at rest, avoid storing them in plain text.
22

===== PAGE 24 =====
• Minimize stored order data: store only SKUs and aggregate metrics, avoid PII unless
strictly required.
• Apply retention policies: allow the shop to delete training history and rules on demand
(future feature).
2.10.4 Threat Model (Simplified STRIDE)
Threat Example Mitigation
Spoofing Attacker calls
/api/recommendwith fake
shop
Current: validate shop domain and apply request hardening (rate limit, allow-list origins). Recommended upgrade: App Proxy + HMAC.
Tampering Request parameters modified in
transit
HTTPS + signature verification
Repudiation No audit trail for training runs Store timestamps and summaries; add TrainingRun logs if versioning is implemented
Information Disclosure Leaking access tokens via logs Redact secrets, encrypt tokens
Denial of Service Flood/api/recommend
requests
Rate limiting + caching
Elevation of Privilege Shopper triggers/api/train Admin session middleware +
CSRF protection
Table 10: STRIDE Threat Analysis and Mitigation
2.11 Performance, Scalability and Optimization
2.11.1 Computational Complexity
For an order containing k unique items, pair enumeration is O( k2). In typical Shopify orders,
k is small, so compute cost is modest. The dominant costs are Shopify API calls and database
persistence. Therefore, performance optimization focuses on batching, caching and reducing I/O.
2.11.2 Optimizing Training
•Use a time window (last 90 or 180 days) to keep datasets relevant and limit cost.
•Batch fetch orders and process streaming to avoid large memory usage.
•Batch insert rules using createMany and transactions.
•Store intermediate counters in memory, optionally counters for incremental training.
2.11.3 Optimizing Recommendations
•Use indexes for antecedentSku queries and limit returned fields.
•Cache rules lists per (shopId, cartSize, antecedentSku) for short TTLS.
23

===== PAGE 25 =====
• Implement "top K per antecedent" during training to reduce DB size and speed inference.
•Avoid expensive SKU-to-product lookups during request time by using ProductMap.
2.11.4 Load Testing Plan
Before production, the recommendation endpoint should be load tested. A simple plan.
•Simulate concurrent shoppers (e.g. 50-200 RPS depending on store size).
•Measure p50/p95 latency and error rate.
•Validate caching effectiveness and DB CPU usage.
•Tune indexes and response payload size if p95 latency exceeds target.
2.12 Error Handling and Observability
2.12.1 Error Taxonomy
•Auth errors (401/403): invalid admin session, invalid HMAC.
•Input validation errors (400): missing SKU, invalid cartSize, malformed query.
•Shopify API errors (429/5xx): rate limit, transient failures.
•Database errors (500): connection issues, constraint violations.
2.12.2 Structured Logging
Logs should include shop domain, stage name, and timing. In the current prototype, training
returns the number of orders processed and rules generated, and request logs can include cart SKUs
and latency. A runId-based logging model is applicable if a background training system is added
in the future.
2.12.3 Monitoring and Alerts (Production)
•Alert on elevated 5xx rate for recommendation endpoint.
•Alert on repeated training failures for a shop (FAILEDruns).
•Dashboard for latency (p50/p95), DB query time, cache hit rate.
•Optional: track recommendation click-through rate if storefront reports events (future).
2.13 Development Environment (Local) and Cloudflare Tunnel
2.13.1 Local Development Workflow
The local workflow typically follows these steps:
24

===== PAGE 26 =====
•Run database locally (or use a remote dev DB) and apply Prisma migrations.
•Start Shopify CLI development server; it creates a Cloudflare tunnel URL.
•Install the app on a development Shopify store using the tunnel URL.
•Open Shopify Admin→Apps→my-plugin-aiand test theTrainbutton.
•Use logs to verify Shopify API calls and DB inserts.
• Test storefront integration by calling /api/recommend via direct URL in dev (Theme Extension + CORS).
2.13.2 Tunnel Considerations
•Tunnel URLs may rotate; ensureAPP_BASE_URLis updated accordingly.
•If the storefront calls the tunnel domain directly, CORS must be configured (dev only).
•For stable testing, App Proxy (shop-domain signed requests) is recommended as a future hardening step.
•Tunnels add latency; performance testing must be done on production-like hosting.
2.14 Production Deployment Plan
2.14.1 Target Production Architecture
A production-ready architecture includes:
•A stable HTTPS domain for the backend (no tunnel).
•Managed PostgreSQL for data durability and backups.
•Optional background worker + queue for long-running training jobs.
•Centralized logging/monitoring and error tracking (e.g., Sentry).
2.14.2 Database Hosting and Backup
Database placement affects latency and reliability. For best performance, host the database
in the same region as the backend. Enable automated backups and point-in-time restore when
available.
•Enable daily backups and keep a retention period (e.g., 7-30 days).
•Run Prisma migrations during deployment with rollback plan.
•Use connection pooling if the platform limits DB connections.
2.14.3 Rollout Strategy
•Stage 1:Deploy backend + DB, verify OAuth install and basic API calls.
•Stage 2:Enable training and validate that rules are written correctly.
•Stage 3:Enable storefront widget (direct URL + CORS). Optional upgrade: App Proxy; validate HMAC and caching.
25

===== PAGE 27 =====
•Stage 4:Monitor metrics and gradually onboard shops.
2.14.4 Operational Considerations
•Rate limit recommendation endpoint and protect it against abusive traffic.
•Offer manual re-train in the admin UI and show last training time.
•Plan for schema evolution: add new columns without breaking old runs.
•Handle app uninstall: cleanup shop data or mark it inactive.
2.15 UI/UX Design
2.15.1 Admin Training Page UI
The admin UI provides a Train button that triggers the training endpoint. The current UI shows
training results such as number of orders processed and number of generated rules. Advanced
controls (parameter panel, RUNNING/SUCCESS/FAILED status polling) are recommended as future
improvements if asynchronous training is introduced.

2.15.2 Storefront Recommendation Widget UI
•Show 3-5 recommended items with image, title, and price.
•Use lazy loading and skeleton UI while waiting for API response.
•Hide the widget if there are no recommendations (avoid empty blocks).
•Provide a consistent placement (product page, cart page) to improve usability.
2.15.3 Accessibility and Performance Notes
•Ensure keyboard navigation and ARIA labels for widget elements.
•Avoid blocking the main thread; load recommendations asynchronously.
•Minimize payload size: return only SKUs and scores, and use cached product metadata.
•Use caching headers where appropriate for static assets.
2.16 Testing and Validation Strategy
2.16.1 Unit Tests
•Transaction builder:given orders, verify extracted SKU sets.
•Rule miner:verify confidence/support calculations using small datasets.
•Ranking logic:verify top-N selection and duplicate filtering.
26

===== PAGE 28 =====
2.16.2 Integration Tests
• Shopify API mock: simulate Shopify API responses (orders/products).
• Database integration: verify RecommendationRule and OrderHistory writes.
• Recommendation endpoint: verify response shape and error handling.
2.16.3 End-to-End Tests
•Install app on a dev store; trigger training; confirm rules appear in DB.
•Call recommendation endpoint from storefront; verify widget displays expected items.
• Failure injection: simulate Shopify API errors and ensure run status becomes FAILED
without corrupting active rules.
2.17 Chapter Summary
This chapter presented a comprehensive design and implementation plan for themy-plugin-ai
Shopify app.
It covered Shopify integration (OAuth, APIs, rate limits, optional webhooks), the training
pipeline (cleaning, mining, tuning, persistence), recommendation service design (API contracts,
ranking, filtering), database schema and indexing, security and observability, as well as dev-to-production
deployment considerations.
The next chapter reports experimental results and demonstrates the correctness of inputs/outputs
in both training and recommendation flows.
27

===== PAGE 29 =====
3 Development and Experimental Results
3.1 Experimental Setup
The app was tested in a local development environment using Shopify CLI and a Cloudflare
tunnel. A SQLite database was connected via Prisma. The experiments validated (1) correctness
of training outputs and (2) usefulness of the recommendation results.
3.2 Sample Input Orders
Order ID Line Items (SKUs) Transaction Set
#1001 A, B {A, B}
#1002 A, B, C {A, B, C}
#1003 C, D {C, D}
#1004 B, C {B, C}
#1005 A, B {A, B}
Table 11: Sample input order
3.3 Example Learned Rules
Using the dataset above with minConfidence = 0.80, the system stores A → B with 1.0
confidence. Rules B → C and B → A are filtered out. This demonstrates threshold-based rule
selection.
3.4 Recommendation Test Cases
Test Case Input Expected Output Notes
TC-01 sku = A, cartSize = 1 recommend B confidence(A→B) = 1
TC-02 sku = A, C, cartSize = 2 recommend B Combine candidates and filter duplicates
TC-03 sku=Unknown or sku = B empty no corresponding recommended sku product
Table 12: Recommendation Test Cases
3.5 Discussion
Pair-based association rules product interpretable and useful recommendations when a shop
has enough order history. They perform especially well for accessory relationships. Limitations
include sparse data for new shops and limited ability to model complex multi-item dependencies.
28

===== PAGE 30 =====
4 Conclusion and Future Developing
4.1 Achievements
• Implemented an embedded Shopify Admin UI for training control.
• Built an end-to-end training pipeline using association rule learning.
• Persisted learned rules via Prisma and served storefront recommendations.
• Outlined a production deployment plan including security and scalability.

4.2 Skills Gained
•Shopify app development workflow and platform constraints.
• Backend API design in Node.js (React Router) and data modeling with Prisma.
•Applied data mining concepts (support/confidence/lift) to a real system.
• System engineering considerations: security, performance, observability and deployment.
•Shopify workflow and app building understanding.
4.3 Future Improvements
•Incremental updates using webhooks to keep rules fresh.
•Extend from pair rules to multi-item rules for catSize >= 2.
•Advanced ranking using lift, popularity, inventory status and business constraints.
•Admin dashboard for monitoring recommendation performance and rule insights.
• Product hardening: background jobs, caching layer (Redis) and comprehensive monitoring.
• Feature update: allow shop owner adjust (CRUD) association rules, optional rules to train...
References
1. Shopify Developer Documentation: https://shopify.dev
2. Prisma Documentation: https://www.prisma.io/docs
3. Association Rule Learning. https://en.wikipedia.org/wiki/Association_rule_learning
4. Node.js Documentation. https://nodejs.org/en/docs
5. Cloudflare tunnel:
https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel
29