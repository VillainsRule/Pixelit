const express = require("express");
const router = express.Router();
const { MongoClient, ServerApiVersion } = require("mongodb");
const uri = process.env["mongoURL"];
const db_name = "pixelit";
const CryptoJS = require("crypto-js");
const rateLimit = require("express-rate-limit");
const Stripe = require("stripe");
const bodyParser = require("body-parser");
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 15, // Limit each IP to 100 requests per `window` (here, per 15 minutes)
  message: "Too many requests, please try again after 15 minutes",
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
});

function rand(min, max) {
  return /*Math.floor(*/ Math.random() * (max - min + 1) /*)*/ + min;
}

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});
let requests;
function formatDateTime(dateTime) {
  const options = {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    hour12: true,
  };
  return dateTime.toLocaleString(undefined, options);
}
const timezoneOffset = new Date().getTimezoneOffset();
const localTime = new Date(Date.now() - timezoneOffset * 60 * 1000);
async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();
    // Send a ping to confirm a successful connection
    await client.db(db_name).command({ ping: 1 }); /*
    const packs = await client.db("pixelit").collection("packs").find().toArray()
    console.log(packs[0].blooks)*/

    requests = await client.db(db_name).collection("requests").find().toArray();
    //console.log(requests);
  } catch {
    console.log("mongodb connection error");
  } /*finally {
    // Ensures that the client will close when you finish/error
    await client.close();
  }*/
}
run().catch(console.dir);

const db = client.db(db_name);
const users = db.collection("users");
const badges = db.collection("badges");
const news = db.collection("news");
const chatm = db.collection("chat"); // mongodb chat
const packs = db.collection("packs");
const encpass = process.env["encpass"]; // encryption password
function encrypt(text, pass) {
  var encrypted = CryptoJS.AES.encrypt(text, pass).toString();
  return encrypted;
}

function decrypt(text, pass) {
  var decrypted = CryptoJS.AES.decrypt(text, pass).toString(CryptoJS.enc.Utf8);
  return decrypted;
}

function generatePasswordHash(password, salt) {
  let passwordWordArray = CryptoJS.enc.Utf8.parse(password);
  const saltWordArray = CryptoJS.enc.Hex.parse(salt);
  passwordWordArray.concat(saltWordArray);
  return CryptoJS.HmacSHA256(passwordWordArray, encpass).toString(
    CryptoJS.enc.Hex,
  );
}

function generateSalt() {
  return CryptoJS.lib.WordArray.random(16).toString(CryptoJS.enc.Hex);
}

function validatePassword(password, saved_hash, salt) {
  const generated_hash = generatePasswordHash(password, salt);
  return generated_hash == saved_hash;
}
router.get("/user", async (req, res) => {
  const session = req.session;
  if (session.loggedIn) {
    const db = client.db(db_name);
    const collection = db.collection("users");
    const user = await collection.findOne({ username: session.username });
    if (user) {
      res.status(200).send({
        username: user.username,
        uid: user._id,
        tokens: user.tokens,
        packs: user.packs,
        pfp: user.pfp,
        banner: user.banner,
        badges: user.badges,
        role: user.role,
        spinned: user.spinned,
        stats: { sent: user.sent, packsOpened: user.packsOpened },
      });
    }
  } else {
    res.status(500).send("You are not logged in");
  }
});
router.post("/login", async (req, res) => {
  try {
    //await client.connect();
    const db = client.db(db_name);
    const collection = db.collection("users");
    const name = req.body.username;
    const pass = req.body.password;
    const user = await collection.findOne({ username: name });
    if (user) {
      if (validatePassword(pass, user.password, user.salt)) {
        req.session.loggedIn = true;
        req.session.username = user.username;
        req.session.tokens = user.tokens;
        req.session.uid = user._id;
        req.session.packs = user.packs;
        req.session.stats = { sent: user.sent, packsOpened: user.packsOpened };
        req.session.pfp = user.pfp;
        req.session.banner = user.banner;
        req.session.badges = user.badges;
        req.session.spinned = user.spinned;
        res.sendStatus(200);
      } else {
        res.status(500).send("Username or Password is incorrect!");
      }
    } else {
      res.status(500).send("User not found!");
    }
  } catch (err) {
    console.error(err);
    res.status(502).send("Server error!");
  }
});
router.post("/register", limiter, async (req, res) => {
  try {
    //await client.connect();
    const db = client.db(db_name);
    const users = db.collection("users");
    const userRequests = db.collection("requests");
    const user = await users.findOne({ username: req.body.username });

    if (user === null) {
      const request = await userRequests.findOne({
        username: req.body.username,
      });
      if (request === null) {
        console.log("adding request");
        const salt = generateSalt();
        const timezone = formatDateTime(localTime);
        await userRequests.insertOne({
          username: req.body.username,
          password: generatePasswordHash(req.body.password, salt),
          salt: salt,
          tokens: 0,
          spinned: 0,
          reason: req.body.reason,
          date: timezone,
        });
        res.sendStatus(200);
      } else {
        res.status(500).send("Request has already been sent!");
      }
    } else {
      res.status(500).send("That username already exists!");
    }
  } catch (err) {
    console.error(err);
    res.status(502).send("Server Error!");
  }
});
router.get("/requests", async (req, res) => {
  //await client.connect();
  if (req.session.loggedIn) {
    const db = client.db(db_name);
    const collection = db.collection("users");
    const user = await collection.findOne({ username: req.session.username });
    if (user) {
      if (["Owner", "Admin", "Moderator", "Helper"].includes(user.role)) {
        const requests = await client
          .db(db_name)
          .collection("requests")
          .find()
          .toArray();
        res.status(200).send(requests);
      } else {
        res.status(500).send("You're not a staff member");
      }
    } else {
      res.status(500).send("The account your under does not exist");
    }
  } else {
    res.status(500).send("You're not logged in");
  }
});
router.post("/addAccount", async (req, res) => {
  //await client.connect();
  const db = client.db(db_name);
  const users = db.collection("users");
  const userRequests = db.collection("requests");
  //const epass = encrypt(pass, encpass);

  const person = await users.findOne({ username: req.session.username });
  if (
    person &&
    ["Owner", "Admin", "Moderator", "Helper"].includes(person.role)
  ) {
    const request = await userRequests.findOne({ username: req.body.username });
    if (req.body.accepted) {
      if (request !== null) {
        if (req.body.accepted == true) {
          await userRequests.deleteOne({ username: req.body.username });
          await users.insertOne({
            username: req.body.username,
            password: req.body.password,
            salt: req.body.salt,
            tokens: 0,
            spinned: 0,
            pfp: "logo.png",
            banner: "pixelitBanner.png",
            role: "Common",
            sent: 0,
            packs: await packs.find().toArray(),
            badges: [],
          });
        }
        try {
          io.emit("getAccounts", "get");
        } catch (e) {
          console.log(e);
        }
        res.status(200).send("User accepted");
      } else {
        res.status(500).send("The request doesn't exist.");
      }
    } else {
      await userRequests.deleteOne({ username: req.body.username });
      res.status(200).send("User declined");
    }
  } else {
    res.status(200).send("You don't exist or you are not a staff member");
  }
});

router.post("/changePassword", async (req, res) => {
  //await client.connect();
  const db = client.db(db_name);
  const users = db.collection("users");

  const user = await users.findOne({ username: req.session.username });

  if (user && user.role == "Owner") {
    const person = await users.findOne({ username: req.body.username });
    if (person != null) {
      users.updateOne(
        { username: req.body.username },
        {
          $set: {
            password: generatePasswordHash(req.body.new_password, person.salt),
          },
        },
      );
      res.status(200).send("Ok");
    } else {
      res.status(404).send("Not Found");
    }
  } else {
    res.status(403).send("Forbidden");
  }
});

router.post("/changePfp", async (req, res) => {
  const session = req.session;
  if (session && session.loggedIn) {
    try {
      //await client.connect();
      console.log(req.body);
      const db = client.db(db_name);
      const users = db.collection("users");
      const body = req.body;
      const pack = session.packs.find((pack) => pack.name == body.parent);
      if (!pack || pack === null) return;
      const blook = pack.blooks.find((blook) => blook.name == body.name);
      console.log(blook);
      if (session.pfp == blook.image) {
        res
          .status(200)
          .send({ message: "This is already your profile picture" });
        return;
      }
      if (blook && blook.owned >= 1) {
        const result = await users.updateOne(
          { username: session.username },
          { $set: { pfp: blook.image } },
        );
        if (result.modifiedCount > 0) {
          res
            .status(200)
            .send({ message: "Profile picture updated successfully." });
        } else {
          res
            .status(500)
            .send({ message: "Failed to update profile picture." });
        }
      }
    } catch (error) {
      console.error("Error updating profile picture:", error);
      res.status(500).send({ message: "Internal server error." });
    }
  } else {
    res.status(401).send({
      message: "You must be logged in to change your profile picture.",
    });
  }
});

router.get("/packs", async (req, res) => {
  if (!req.session.loggedIn) {
    res.status(500).send("You must be logged in to access this page.");
    return;
  }
  //await client.connect();
  const db = client.db(db_name);
  const collection = db.collection("packs");
  const packs = await collection.find().toArray();
  res.status(200).send(packs);
});

router.get("/openPack", async (req, res) => {
  const session = req.session;
  if (session && session.loggedIn) {
    //await client.connect();
    //console.log("openpackreq");

    const user = {
      name: session.username,
    };

    const opack = req.query.pack;

    // Retrieve user data from MongoDB
    const person = await users.findOne({ username: user.name });
    //console.log("Retrieved user data:", person); // Log retrieved user data

    if (person === null) return;

    // Validate password
    /*if (!validatePassword(user.pass, person.password, person.salt)) {
      console.log("False password");
      return;
    }*/

    // Retrieve pack data from MongoDB
    /*console.log(opack)
    console.log(await packs.find().toArray())*/
    const pack = await packs.findOne({ name: opack });
    //console.log("Retrieved pack data:", pack); // Log retrieved pack data

    if (pack === null) {
      console.log("Invalid pack");
      return;
    }

    if (person.tokens < pack.cost) return;

    const blooks = pack.blooks;
    let totalchance = 0;
    for (const b of blooks) {
      totalchance += Number(b.chance);
    }
    const randnum = rand(0, totalchance);
    let currentchance = 0;

    //console.log(pack);

    //console.log("test", randnum, totalchance);

    for (const b of blooks) {
      const blook = b;
      //console.log("Current blook:", blook); // Log current blook

      if (
        randnum >= currentchance &&
        randnum <= currentchance + Number(blook.chance)
      ) {
        //console.log("Selected blook:", blook); // Log selected blook

        // Update user data in MongoDB
        /*await users
              .updateOne(
                { username: person.name },
                { $inc: { [`packs.${pack.name}.blooks.${blook.name}.owned`]: 1 } },
              )
              .then((result) => {
                console.log("Update operation result:", result);
              })
              .catch((error) => {
                console.error("Error updating database:", error);
              });*/
        /*
            await users
              .updateOne(
                { username: person.name }, // Identify the user based on some unique identifier
                {
                  $inc: {
                    "packs.$[packName].blooks.$[blookName].owned": 1, // Update the owned property of the specific blook
                  },
                },
                {
                  arrayFilters: [
                    { "packName.name": pack.name }, // Filter to find the specific pack within the packs array
                    { "blookName.name": blook.name }, // Filter to find the specific blook within the blooks array of the selected pack
                  ],
                },
              )
              .then((result) => {
                console.log("Update operation result+$:37&+:", result);
              });
    */
        // Emit openPack event with selected blook
        const result = await users.updateOne(
          {
            username: user.name,
            "packs.name": pack.name,
            "packs.blooks.name": blook.name,
          },
          {
            $inc: { "packs.$[pack].blooks.$[blook].owned": 1, packsOpened: 1 },
          },
          {
            arrayFilters: [
              { "pack.name": pack.name },
              { "blook.name": blook.name },
            ],
          },
        );
        await users.updateOne(
          { username: user.name },
          { $inc: { tokens: -pack.cost } },
        );

        console.log(
          `${result.matchedCount} document(s) matched the filter, updated ${result.modifiedCount} document(s)`,
        );

        res.status(200).send({ pack: pack.name, blook: blook });
        /*io.to(socket.id).emit("openPack", {
          pack: pack.name,
          blook: blook,
        });*/
        //const testuser = await users.findOne({ username: user.name });
        //io.to(socket.id).emit("tokens", await testuser.tokens);

        console.log(`${user.name} opened ${pack.name} and got ${blook.name}`);
      }
      currentchance += Number(blook.chance);
    }
  }
});

router.get("/users", async (req, res) => {
  const session = req.session;
  if (!(session && session.loggedIn)) {
    res.status(500).send("You must be logged in");
    return;
  }
  const users2 = await users.find().toArray();
  users2.forEach((user) => {
    delete user.password;
    delete user.salt;
  });
  res.status(200).send({ users: users2 });
});

router.post("/addPack", async (req, res) => {
  const session = req.session;
  if (session == null || !session.loggedIn) return;

  const user = await users.findOne({ username: req.session.username });

  if (user == null || user.role !== "Owner") {
    console.log("need authorisation to add packs");
    res.status(500).send("Need authorisation to add packs");
    return;
  }
  const pack = req.body;

  const newpack = {
    name: pack.name,
    image: pack.image,
    cost: pack.cost,
    blooks: [],
  };
  try {
    await packs
      .insertOne(newpack)
      .then((result) => {
        console.log("Update operation result:", result);
      })
      .catch((error) => {
        console.error("Error updating database:", error);
      });
    await users
      .updateMany(
        { packs: { $nin: [pack.name] } },
        { $push: { packs: newpack } },
      )
      .then((result) => {
        console.log("Update operation result:", result);
      })
      .catch((error) => {
        console.error("Error updating database:", error);
      });
  } catch (e) {
    console.log(e);
  }
  console.log("added new pack: " + newpack.name);
  const packs2 = await packs.find().toArray();
  res.status(200).send({ packs: packs2 });
});

router.post("/removePack", async (req, res) => {
  const session = req.session;
  if (session == null || !session.loggedIn) return;
  const user = await users.findOne({ username: req.session.username });
  if (user == null || user.role !== "Owner") {
    console.log("need authorisation to remove packs");
    res.status(500).send("Need authorisation to remove packs");
    return;
  }
  console.log("removing pack: " + req.body.name);
  const pack = req.body;
  try {
    await packs
      .deleteOne({ name: pack.name })
      .then((result) => {
        console.log("Update operation result:", result);
      })
      .catch((error) => {
        console.error("Error updating database:", error);
      });
    await users
      .updateMany(
        { "packs.name": pack.name }, // Match documents where the pack exists in the packs array
        { $pull: { packs: { name: pack.name } } }, // Remove the pack from the packs array
      )
      .then((result) => {
        console.log("Update operation result:", result);
      })
      .catch((error) => {
        console.error("Error updating database:", error);
      });
  } catch (e) {
    console.log(e);
  }
  const packs2 = await packs.find().toArray();
  res.status(200).send({ packs: packs2 });
});

router.post("/addBlook", async (req, res) => {
  const session = req.session;
  if (session == null || !session.loggedIn) return;
  const user = await users.findOne({ username: req.session.username });
  if (user == null || user.role !== "Owner") {
    console.log("need authorisation to add blooks");
    res.status(500).send("Need authorisation to add blooks");
    return;
  }
  const blook = req.body;

  try {
    await packs
      .updateOne(
        { name: blook.parent },
        {
          $push: {
            blooks: {
              name: blook.name, // Example: New blook name
              imageUrl: blook.image, // Example: URL of the blook image
              rarity: blook.rarity, // Example: Rarity of the blook
              chance: blook.chance, // Example: Chance of getting the blook (in percentage)
              parent: blook.parent,
              color: blook.color,
              owned: 0,
            },
          },
        },
      )
      .then((result) => {
        console.log("Update operation result:", result);
      })
      .catch((error) => {
        console.error("Error updating database:", error);
      });
    await users.updateMany(
      { "packs.name": blook.parent }, // Match documents where the parent pack exists
      { $addToSet: { "packs.$[pack].blooks": blook } }, // Add the blook to the blooks array of the specified pack
      { arrayFilters: [{ "pack.name": blook.parent }] }, // Specify the array filter to identify the pack to update
    );
  } catch (e) {
    console.log(e);
  }
});

router.post("/removeBlook", async (req, res) => {
  const session = req.session;
  if (session == null || !session.loggedIn) return;
  const user = await users.findOne({ username: req.session.username });
  if (user == null || user.role !== "Owner") {
    console.log("need authorisation to add blooks");
    res.status(500).send("Need authorisation to add blooks");
    return;
  }
  const blook = req.body;

  await packs
    .updateOne(
      { name: blook.parent },
      {
        $pull: {
          blooks: {
            name: blook.name,
          },
        },
      },
    )
    .then((result) => {
      console.log("Update operation result:", result);
    })
    .catch((error) => {
      console.error("Error updating database:", error);
    });
  await users
    .updateMany(
      { "packs.name": blook.parent, "packs.blooks.name": blook.name }, // Match documents where the parent pack contains the blook
      { $pull: { "packs.$[pack].blooks": { name: blook.name } } }, // Remove the blook from the specified pack
      { arrayFilters: [{ "pack.name": blook.parent }] }, // Specify the array filter to identify the pack to update
    )
    .then((result) => {
      console.log("Update operation result:", result);
    })
    .catch((error) => {
      console.error("Error updating database:", error);
    });
  console.log(`removed blook from ${blook.parent}: ` + blook.name);
  res.status(200).send("Removed blook");
});

// Badge-related Routes from badgeeditor.js
router.get("/getAccounts", async (req, res) => {
  try {
    const usersList = await users.find().toArray();
    res.status(200).json(usersList);
  } catch (err) {
    res.status(500).send("Error retrieving users");
  }
});
router.get("/getBadges", async (req, res) => {
  try {
    const badgesList = await badges.find().toArray();
    res.status(200).json(badgesList);
  } catch (err) {
    res.status(500).send("Error retrieving badges");
  }
});
router.post("/addBadge", async (req, res) => {
  const { username, badge } = req.body;
  try {
    const user = await users.findOne({ username });
    if (!user) {
      return res.status(404).send("User not found");
    }
    if (!user.badges.includes(badge.name)) {
      await users.updateOne({ username }, { $push: { badges: badge.name } });
      res.status(200).json({ success: true });
    } else {
      res
        .status(400)
        .json({ success: false, msg: "User already has this badge!" });
    }
  } catch (err) {
    res.status(500).send("Error adding badge");
  }
});
router.post("/removeBadge", async (req, res) => {
  const { username, badge } = req.body;
  try {
    const user = await users.findOne({ username });
    if (!user) {
      return res.status(404).send("User not found");
    }
    if (user.badges.includes(badge.name)) {
      await users.updateOne({ username }, { $pull: { badges: badge.name } });
      res.status(200).json({ success: true });
    } else {
      res
        .status(400)
        .json({ success: false, msg: "User does not have this badge!" });
    }
  } catch (err) {
    res.status(500).send("Error removing badge");
  }
});

router.get("/claim", async (req, res) => {
  const session = req.session;
  if (session == null || !session.loggedIn) return;

  const user = await users.findOne({ username: req.session.username });

  if (date.now() - user.spinned < 1000 * 60 * 60) {
    const tokenValues = [
      500, 550, 600, 650, 700, 750, 800, 850, 900, 950, 1000,
    ];
    const randomIndex = Math.floor(Math.random() * tokenValues.length);
    const tokensWon = tokenValues[randomIndex];

    const result = await users.updateOne(
      { username: session.username },
      { $inc: { tokens: tokensWon }, $set: { spinned: Date.now() } },
    );
    if (result.modifiedCount > 0) {
      console.log("Tokens won:", tokensWon);
      res.status(200).send({ tokens: tokensWon });
    }
  } else {
    res.status(500).send(`Wait for ${(date.now() - user.spinned / 3600000).toFixed(2)} hours before claiming again`)
  }
});

// Router to handle selling a blook
router.post("/sellBlook", async (req, res) => {
});

// Body parser middleware to handle JSON requests
router.use(bodyParser.json());

// Create a checkout session for "Pixelit Plus"
router.post("/create-checkout-session", async (req, res) => {
  const { priceId } = req.body;
  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      mode: "subscription", // Use 'payment' for one-time payments
      success_url: `${req.headers.origin}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${req.headers.origin}/cancelled.html`,
    });
    res.status(200).json({ id: session.id });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
