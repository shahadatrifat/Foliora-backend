const express = require("express");
const app = express();
const port = process.env.PORT || 3000;
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const cors = require("cors");
const admin = require("firebase-admin");
require("dotenv").config();

// Middleware
app.use(
  cors({
    origin: [
        "https://foliora-project.vercel.app",
        "https://foliora-project-iojx2efk6-zazazawgs-projects.vercel.app", 
        "https://foliora.netlify.app", 
    ],
    credentials: true,
  })
);
app.use(express.json());

// Firebase Authentication Middleware
const serviceAccount = {
   type: 'service_account',
  project_id: process.env.FIREBASE_PROJECT_ID,
  private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
  private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),  
  client_email: process.env.FIREBASE_CLIENT_EMAIL,
  client_id: process.env.FIREBASE_CLIENT_ID,
  auth_uri: process.env.FIREBASE_AUTH_URI,
  token_uri: process.env.FIREBASE_TOKEN_URI,
  auth_provider_x509_cert_url: process.env.FIREBASE_AUTH_PROVIDER_X509_CERT_URL,
  client_x509_cert_url: process.env.FIREBASE_CLIENT_X509_CERT_URL,
}
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});
const verifyFirebaseToken = async (req, res, next) => {
  const authHeader = req.headers?.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).send({ error: "Unauthorized access" });
  }
  const token = authHeader?.split(" ")[1];
  if (!token) {
    return res.status(401).send({ error: "Unauthorized access" });
  }
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    req.decoded = decoded;
    // console.log(decoded);
    next();
  } catch (error) {
    return res.status(403).send({ error: "Forbidden access" });
  }
};
// verify email
const verifyTokenEmail = async (req, res, next) => {
  if (req.query.email !== req.decoded.email) {
    return res.status(403).send({ error: "Forbidden access" });
  }
  next();
};

const uri = process.env.MONGO_URI;
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    const booksCollection = client.db("foliora").collection("books");

    // POST: Add book
    app.post("/api/books", async (req, res) => {
      try {
        const book = {
          ...req.body,
          reading_status: req.body.reading_status || "Not Started",
          reviews: [],
          upvotes: [],
        };
        const result = await booksCollection.insertOne(book);
        res.send(result);
      } catch (error) {
        res
          .status(500)
          .send({ error: "Failed to add book", message: error.message });
      }
    });
    // GET: All books
    app.get("/api/books", async (req, res) => {
      try {
        const result = await booksCollection.find().toArray();
        res.send(result);
      } catch (error) {
        res
          .status(500)
          .send({ error: "Failed to fetch books", message: error.message });
      }
    });
    // GET: Single book by ID
    app.get("/api/books/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };
        const result = await booksCollection.findOne(query);
        res.send(result);
      } catch (error) {
        res
          .status(500)
          .send({ error: "Failed to fetch book", message: error.message });
      }
    });
    // GET: my books of a specific user
    app.get(
      "/api/my-books",
      verifyFirebaseToken,
      verifyTokenEmail,
      async (req, res) => {
        const email = req.query.email;

        try {
          const result = await booksCollection
            .find({ "uploader.uploaderEmail": email })
            .toArray();
          res.send(result);
        } catch (error) {
          res
            .status(500)
            .send({ error: "Failed to fetch books", message: error.message });
        }
      }
    );
    // get:reviews for homepage
    app.get("/api/recent-reviews", async (req, res) => {
      try {
        const recentReviews = await booksCollection
          .aggregate([
            { $unwind: "$reviews" }, // Flatten the reviews array
            { $sort: { "reviews.date": -1 } }, // Sort reviews by date in descending order
            { $limit: 5 },
            {
              $project: {
                _id: 0,
                bookId: "$_id",
                bookTitle: "$title",
                reviewerName: "$reviews.name",
                reviewerPhoto: "$reviews.photo",
                rating: "$reviews.rating",
                comment: "$reviews.comment",
                date: "$reviews.date",
              },
            },
          ])
          .toArray();

        res.send(recentReviews);
      } catch (error) {
        res
          .status(500)
          .send({ error: "Failed to fetch reviews", message: error.message });
      }
    });
    // DELETE: Delete a book
    app.delete("/api/books/:id", verifyFirebaseToken, async (req, res) => {
      try {
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };
        const result = await booksCollection.deleteOne(query);
        res.send(result);
      } catch (error) {
        res
          .status(500)
          .send({ error: "Failed to delete book", message: error.message });
      }
    });

    // PUT: Update a book
    app.put("/api/books/:id", verifyFirebaseToken, async (req, res) => {
      try {
        const id = req.params.id;
        const updatedBook = req.body;
        const query = { _id: new ObjectId(id) };
        const updatedData = {
          $set: updatedBook,
        };
        const result = await booksCollection.updateOne(query, updatedData);
        if (result.modifiedCount === 0) {
          return res.status(404).send({ error: "Book not found" });
        }
        res.send({ message: "Book updated successfully", result });
      } catch (error) {
        res
          .status(500)
          .send({ error: "Failed to update book", message: error.message });
      }
    });

    // PATCH: Update reading status
    app.patch(
      "/api/books/:id/reading-status",
      verifyFirebaseToken,
      async (req, res) => {
        const bookId = req.params.id;
        const { email, readingStatus } = req.body;

        try {
          const book = await booksCollection.findOne({
            _id: new ObjectId(bookId),
          });

          if (!book) {
            return res.status(404).json({ error: "Book not found" });
          }

          if (!book.readingStatus) {
            book.readingStatus = [];
          }

          const userStatusIndex = book.readingStatus.findIndex(
            (status) => status.email === email
          );

          if (userStatusIndex !== -1) {
            book.readingStatus[userStatusIndex].status = readingStatus;
          } else {
            book.readingStatus.push({
              email,
              status: readingStatus || "Not Started",
            });
          }

          const updatedBook = await booksCollection.findOneAndUpdate(
            { _id: new ObjectId(bookId) },
            { $set: { readingStatus: book.readingStatus } },
            { returnDocument: "after" }
          );

          res.status(200).json(updatedBook.value);
        } catch (error) {
          res
            .status(500)
            .json({ error: "Server error", message: error.message });
        }
      }
    );
    // PATCH: Upvote a book
    app.patch(
      "/api/books/:id/upvote",
      verifyFirebaseToken,
      async (req, res) => {
        const bookId = req.params.id;
        const { email, name, photo } = req.body;

        try {
          const book = await booksCollection.findOne({
            _id: new ObjectId(bookId),
          });

          if (!book) {
            return res.status(404).json({ error: "Book not found" });
          }

          const isUploader = book.uploader.some(
            (uploader) => uploader.uploaderEmail === email
          );

          if (isUploader) {
            return res
              .status(403)
              .json({ error: "You can't upvote your own book" });
          }

          const alreadyUpvoted = book.upvotes.some((up) => up.email === email);
          if (alreadyUpvoted) {
            return res
              .status(400)
              .json({ error: "You already upvoted this book" });
          }

          const newUpvote = { email, name, photo };
          const updatedBook = await booksCollection.findOneAndUpdate(
            { _id: new ObjectId(bookId) },
            { $push: { upvotes: newUpvote } },
            { returnDocument: "after" }
          );
          res.status(200).json(updatedBook.value);
        } catch (error) {
          res
            .status(500)
            .json({ error: "Server error", message: error.message });
        }
      }
    );

    // POST: Add review
    app.post("/api/books/:id/review", verifyFirebaseToken, async (req, res) => {
      const bookId = req.params.id;
      const { email, name, photo, rating, comment, date } = req.body;
      try {
        const book = await booksCollection.findOne({
          _id: new ObjectId(bookId),
        });
        if (!book) {
          return res.status(404).json({ error: "Book not found" });
        }

        const existingReviewIndex =
          book.reviews?.findIndex((r) => r.email === email) ?? -1;
        if (existingReviewIndex !== -1) {
          return res
            .status(400)
            .json({ error: "You already reviewed this book" });
        }

        const newReview = { email, name, photo, rating, comment, date };
        const updatedBook = await booksCollection.findOneAndUpdate(
          { _id: new ObjectId(bookId) },
          { $push: { reviews: newReview } },
          { returnDocument: "after" }
        );

        res.status(200).json(updatedBook.value);
      } catch (err) {
        res
          .status(500)
          .json({ error: "Failed to add review", message: err.message });
      }
    });

    // DELETE: Delete review
    app.delete(
      "/api/books/:id/review",
      verifyFirebaseToken,
      async (req, res) => {
        const bookId = req.params.id;
        const { email } = req.body;

        try {
          // Use the findOneAndUpdate method to pull (remove) the review with the matching email
          const result = await booksCollection.findOneAndUpdate(
            { _id: new ObjectId(bookId) }, // Find the book by its ID
            { $pull: { reviews: { email } } }, // Remove the review by matching the email
            { returnDocument: "after" } // Return the updated document
          );

          // Check if the review was found and removed
          if (!result.value) {
            return res.status(404).json({ error: "Review not found" });
          }

          // Successfully removed the review, return the updated book document
          res.status(200).json(result.value);
        } catch (error) {
          // Handle errors and send the appropriate response
          res
            .status(500)
            .json({ error: "Failed to delete review", message: error.message });
        }
      }
    );

    // await client.db("admin").command({ ping: 1 });
    // console.log("✅ Successfully connected to MongoDB");
  } catch (error) {
    console.log("❌ MongoDB connection error:", error);
  }
}

run().catch(console.dir);

// Default root route
app.get("/", (req, res) => {
  res.send(" Foliora Server is running!");
});

// Start server
app.listen(port, () => {
  console.log(` Server is listening on port ${port}`);
});