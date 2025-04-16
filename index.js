require("dotenv").config();
const express = require("express");
const cookieParser = require('cookie-parser');
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const port = process.env.PORT || 5000;
const cors = require("cors");
const app = express();
const Stripe = require("stripe");
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const jwt = require('jsonwebtoken');


app.use(cors({
  origin: ["http://localhost:5173", ],
  credentials: true,
}));

app.use(express.json());
app.use(cookieParser());

const verifyToken = (req, res, next)=>{
  const token = req.cookies.token;
  if(!token){
    return res
    .status(401)
    .send("UnAuthorized: Authentication credentials are missing");
  }

  jwt.verify(token, process.env.JSON_TOKEN, (err, decoded)=>{
    if (err) {
      return res
        .status(401)
        .send("UnAuthorized: Authentication credentials are inValid");
    }

    req.user = decoded;
    next();
  })
}

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.khimxsm.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    const userCollection = client.db("shohojmart").collection("users");
    const productCollection = client.db("shohojmart").collection("products");
    const reviewCollection = client.db("shohojmart").collection("reviews");
    const cartCollection = client.db("shohojmart").collection("cart");
    const wishListCollection = client.db("shohojmart").collection("wishList");
    const paymentCollection = client.db("shohojmart").collection("payment");
    const galleryCollection = client.db("shohojmart").collection("gallery");

    app.post('/jwt', (req, res)=>{
      const user = req.body;
      const token = jwt.sign(user, process.env.JSON_TOKEN, {
        expiresIn:'7d',
      })
      res.cookie('token', token, {
        secure: process.env.NODE_ENV === "production",
        sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
      }).send({status:true})
    })

    app.post('/logout', (req, res)=>{
      res.clearCookie('token', {
        secure: process.env.NODE_ENV === "production",
          sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",  
      }).send({status:false})
    })

     // verify Admin
     const verifyAdmin = async (req, res, next) => {
      const email = req.user.email;
      const query = { email: email };
      const userData = await userCollection.findOne(query);
      const isAdmin = userData.role === "admin";
      if (!isAdmin) {
        return res.status(403).send("forbidden Access");
      }
      next();
    };

    // stripe setup--------------------------------------->
    app.post("/create-payment-intent", async (req, res) => {
      const { price } = req.body;
      const amount = parseFloat(price * 100) || 51;

      const paymentIntent = await stripe.paymentIntents.create({
        amount: amount,
        currency: "usd",
        payment_method_types: ["card"],
        // confirm: true,
      });
      res.send({ clientSecret: paymentIntent.client_secret });
    });

    //  post Payment data on server and reduce stock
    app.post('/payment', async (req, res) => {
      const body = req.body;
      const itemsList = body.itemsList;
    
      for (const item of itemsList) {
        const productId = item;
        const objectId = new ObjectId(productId);
    
        await productCollection.updateOne(
          { _id: objectId, stock: { $gt: 0 } }, 
          { $inc: { stock: -1 } }
        );
      }
    
      const result = await paymentCollection.insertOne(body);
      res.send(result);
    });
    
    

    // get all order data
    app.get('/allOrder', verifyToken,verifyAdmin, async(req, res)=>{
      const sort = req.query.sort;
      let query = {}
      if(sort){
        query = {status:sort}
      }
      const result = await paymentCollection.find(query).sort({_id: -1}).toArray();
      res.send(result);
    })

    // get single order data
    app.get('/singleOrder/:id', verifyToken, async(req, res)=>{
      const id = req.params.id;
      const query = {_id: new ObjectId(id)}
      const result = await paymentCollection.findOne(query)
      res.send(result)
    })

    // get user Order Data
    app.get('/myOrder/:email',verifyToken, async(req, res)=>{
      const email = req.params.email;
      const useremail = req.user.email;
      if(useremail !== email){
        return res.status(403).send("forbidden Access")
      }
      const query = {userEmail: email}
      const result = await paymentCollection.find(query).sort({_id: -1}).toArray();
      res.send(result);
    })

    // update single order status
    app.patch('/updateOrder/:id', verifyToken, verifyAdmin, async(req, res)=>{
      const id = req.params.id;
      const body = req.body;
      const query = {_id: new ObjectId(id)}
      const updateDoc = {
        $set:{
          status: body.status
        }
      }
      const result = await paymentCollection.updateOne(query, updateDoc)
      res.send(result)
    })

    // Gallery Api -------------------------------------------->
    app.post ('/gallery',verifyToken, async(req, res)=>{
      const body = req.body;
      const result = await galleryCollection.insertOne(body)
      res.send(result)
    })
    
    //  user Api ------------------------------------------------------>
    // post user data---------------
    app.post("/users", async (req, res) => {
      const user = req.body;
      const isExist = await userCollection.findOne({ email: user.email });
      if (isExist) {
        return res.send({ status: false });
      }
      const result = await userCollection.insertOne({
        ...user,
        role: "user",
        status: "",
      });
      res.send({ status: true, result });
    });

    // update user name
    app.patch('/updateName/:email', verifyToken, async(req, res)=>{
      const email = req.params.email;
      const body = req.body;
      const query = {email: email}
      const updateDoc={
        $set:{
          name:body.name
        }
      }
      const result = await userCollection.updateOne(query, updateDoc);
      res.send(result)
    })

    // update user cover Photo
    app.patch('/updateCover/:email', verifyToken, async(req, res)=>{
      const email = req.params.email;
      const body = req.body;
      const query = {email: email}
      const updateDoc={
        $set:{
          cover:body.cover
        }
      }
      const result = await userCollection.updateOne(query, updateDoc);
      res.send(result)
    })

     // update user Profile Photo
     app.patch('/updateProfilePhoto/:email', verifyToken, async(req, res)=>{
      const email = req.params.email;
      const body = req.body;
      const query = {email: email}
      const updateDoc={
        $set:{
          profile:body.photo
        }
      }
      const result = await userCollection.updateOne(query, updateDoc);
      res.send(result)
    })

    // get profile gallery by email--------
    app.get('/gallery/:email',verifyToken, async(req, res)=>{
      const email = req.params.email;
      const query = {email:email}
      const result = await galleryCollection.find(query).sort({_id: -1}).toArray();
      res.send(result);
    })

    // delete gallery photo by id
    app.delete('/gallery/:id',verifyToken, async(req, res)=>{
      const id = req.params.id;
      const query = {_id: new ObjectId(id)}
      const result = await galleryCollection.deleteOne(query);
      res.send(result);
    })

    // get All User
    app.get("/allUser", verifyToken, verifyAdmin, async (req, res) => {
      const role = req.query.role;
      let query = {};
      if (role) {
        query = { role: role };
      }
      const result = await userCollection.find(query).toArray();
      res.send(result);
    });

    // update user Data role
    app.patch("/updateUser/:id", verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const body = req.body;
      const query = { _id: new ObjectId(id) };
      const updateDoc = {
        $set: {
          role: body.role,
        },
      };

      const result = await userCollection.updateOne(query, updateDoc);
      res.send(result);
    });

    // delete user Data
    app.delete("/deleteUser/:id",verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await userCollection.deleteOne(query);
      res.send(result);
    });

    // get user Data by email---------
    app.get("/user/:email", async (req, res) => {
      const email = req.params.email;
      const query = { email: email };
      const result = await userCollection.findOne(query);
      res.send(result);
    });

    // post product data -----------
    app.post("/addProduct",verifyToken, verifyAdmin, async (req, res) => {
      const data = req.body;
      data.price = parseInt(data.price);
      data.stock = parseInt(data.stock);
      const result = await productCollection.insertOne(data);
      res.send(result);
    });

    // update product data by id
    app.patch("/product/:id",verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const product = req.body;
      const query = { _id: new ObjectId(id) };
      const updateDoc = {
        $set: {
          title: product.title,
          brandName: product.brandName,
          modelName: product.modelName,
          description: product.description,
          category: product.category,
          price: parseInt(product.price),
          feature: product.feature,
          stock: parseInt(product.stock),
          productCode: product.productCode,
          image: product.image,
          updateOn: product.updateOn,
        },
      };
      const result = await productCollection.updateOne(query, updateDoc);
      res.send(result);
    });

    // get all product by category, all, limit & sort --------------
    app.get("/allProducts", async (req, res) => {
      try {
        const category = req.query.category;
        const limit = parseInt(req.query.limit);
        const sort = req.query.sort;

        let query = {};
        let limitNumber = 0;
        let sortQuery = {};

        if (category) {
          query = { category: category };
        }

        if (limit) {
          limitNumber = limit;
        }

        if (sort === "recent") {
          sortQuery = { postDate: -1 };
        }

        const result = await productCollection
          .find(query)
          .sort(sortQuery)
          .limit(limitNumber)
          .toArray();

        res.send(result);
      } catch (error) {
        console.error("Error fetching products:", error);
        res.status(500).send({ message: "Server Error", error });
      }
    });

    // get all product for all collection with pagination
    app.get("/allCollection", async (req, res) => {
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 12;
      const category = req.query.category;
      const search = req.query.search;
      const sort = parseInt(req.query.sort);

      let query = {};

      if (category) {
        query.category = category;
      }

      if (search) {
        query.title = { $regex: search, $options: "i" };
      }

      const skip = (page - 1) * limit;

      // Build sort object
      let sortQuery = { _id: -1 };
      if (sort === 1 || sort === -1) {
        sortQuery = { price: sort };
      }

      const items = await productCollection
        .find(query)
        .skip(skip)
        .limit(limit)
        .sort(sortQuery)
        .toArray();

      const totalItems = await productCollection.countDocuments(query);

      res.send({
        items,
        totalItems,
        totalPages: Math.ceil(totalItems / limit),
        currentPage: page,
      });
    });

    // get single product data by Id
    app.get("/product/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await productCollection.findOne(query);
      res.send(result);
    });

    // delete product data----------------
    app.delete("/deleteProduct/:id", verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await productCollection.deleteOne(query);
      res.send(result);
    });

    // review Api ------------------------------------------------------------->

    // post review data
    app.post("/review", async (req, res) => {
      const review = req.body;
      const result = await reviewCollection.insertOne(review);
      res.send(result);
    });

    // get review data
    app.get("/reviews/:id", async (req, res) => {
      const id = req.params.id;
      const query = { productId: id };
      const result = await reviewCollection
        .find(query)
        .sort({ date: -1 })
        .limit(10)
        .toArray();
      res.send(result);
    });

    // cart Api------------------------------------------------------------------------->

    // post cart data single
    app.post("/cart",verifyToken, async (req, res) => {
      const cart = req.body;
      const isExist = await cartCollection.findOne({
        porductId: cart.porductId,
        userEmail: cart.userEmail,
      });
      if (isExist) {
        return res.status(400).send({ message: "Already Added" });
      }
      const result = await cartCollection.insertOne(cart);
      res.send(result);
    });

    // post cart data many
    app.post("/carts",verifyToken, async (req, res) => {
      const data = req.body;
      const options = { ordered: true };
      const result = await cartCollection.insertMany(data, options);
      res.send(result);
    });

    // get cart Data
    app.get("/cart/:email", async (req, res) => {
      const email = req.params.email;
      const query = { userEmail: email };
      const result = await cartCollection.find(query).toArray();
      res.send(result);
    });

    // delete cart data by id--
    app.delete("/cart/:id",verifyToken, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await cartCollection.deleteOne(query);
      res.send(result);
    });

    // delete all cart data by email
    app.delete("/userCart/:email", verifyToken, async (req, res) => {
      const email = req.params.email;
      const query = { userEmail: email };
      const result = await cartCollection.deleteMany(query);
      res.send(result);
    });

    // wish List API --------------------------------------------------------->

    // post wish list
    app.post("/wishlist",verifyToken, async (req, res) => {
      const wishList = req.body;
      const isExist = await wishListCollection.findOne({
        porductId: wishList.porductId,
        userEmail: wishList.userEmail,
      });
      if (isExist) {
        return res.status(400).send({ message: "Already Added" });
      }
      const result = await wishListCollection.insertOne(wishList);
      res.send(result);
    });

    // get wish data
    app.get("/wishlist/:email",verifyToken, async (req, res) => {
      const email = req.params.email;
      const useremail = req.user.email;
      if(useremail !== email){
        return res.status(403).send("forbidden Access")
      }
      const query = { userEmail: email };
      const result = await wishListCollection.find(query).toArray();
      res.send(result);
    });

    // delete wish data
    app.delete("/wish/:id",verifyToken, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await wishListCollection.deleteOne(query);
      res.send(result);
    });

    // delete all wish data by email
    app.delete("/userWish/:email", verifyToken, async (req, res) => {
      const email = req.params.email;
      const useremail = req.user.email;
      if(useremail !== email){
        return res.status(403).send("forbidden Access")
      }
      const query = { userEmail: email };
      const result = await wishListCollection.deleteMany(query);
      res.send(result);
    });

    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("ShohojMart Server Running");
});

app.listen(port, () => {
  console.log(`server Running At port ${port}`);
});
