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
      
      "https://foliora.netlify.app",
      "http://localhost:5173",
      "http://localhost:3000",
      "foliora-project-bzo2o054t-zazazawgs-projects.vercel.app"

      
    ],
    credentials: true,
  })
);
app.use(express.json());

// Firebase Authentication Middleware
const serviceAccount = {
  type: "service_account",
  project_id: process.env.FIREBASE_PROJECT_ID,
  private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
  private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
  client_email: process.env.FIREBASE_CLIENT_EMAIL,
  client_id: process.env.FIREBASE_CLIENT_ID,
  auth_uri: process.env.FIREBASE_AUTH_URI,
  token_uri: process.env.FIREBASE_TOKEN_URI,
  auth_provider_x509_cert_url: process.env.FIREBASE_AUTH_PROVIDER_X509_CERT_URL,
  client_x509_cert_url: process.env.FIREBASE_CLIENT_X509_CERT_URL,
};
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
    next();
  } catch (error) {
    return res.status(403).send({ error: "Forbidden access" });
  }
};

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
    strict: false,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    const booksCollection = client.db("foliora").collection("books");
    const readingGoalsCollection = client
      .db("foliora")
      .collection("readingGoals");
    const bookmarksCollection = client.db("foliora").collection("bookmarks");

    // POST: Add book
    app.post("/api/books", async (req, res) => {
      try {
        const book = {
          ...req.body,
          reading_status: req.body.reading_status || "Not Started",
          reviews: [],
          upvotes: [],
          createdAt: new Date(),
        };
        const result = await booksCollection.insertOne(book);
        res.send(result);
      } catch (error) {
        res
          .status(500)
          .send({ error: "Failed to add book", message: error.message });
      }
    });

    // GET: All books with SORTING, FILTERING, PAGINATION & SEARCH
    app.get("/api/books", async (req, res) => {
      try {
        const {
          sort = "newest",
          genre,
          search,
          page = 1,
          limit = 12,
          minRating,
          author,
        } = req.query;

        let match = {};

        if (search) {
          match.$or = [
            { title: { $regex: search, $options: "i" } },
            { author: { $regex: search, $options: "i" } },
            { genre: { $regex: search, $options: "i" } },
          ];
        }

        if (genre && genre !== "all") {
          match.genre = genre;
        }

        if (author) {
          match.author = { $regex: author, $options: "i" };
        }

        const pipeline = [
          {
            $addFields: {
              upvoteCount: { $size: { $ifNull: ["$upvotes", []] } },
              averageRating: { $avg: "$reviews.rating" },
            },
          },
          { $match: match },
        ];

        if (minRating) {
          pipeline.push({
            $match: { averageRating: { $gte: parseFloat(minRating) } },
          });
        }

        // Sorting logic
        let sortStage = {};
        switch (sort) {
          case "title-asc":
            sortStage = { title: 1 };
            break;
          case "title-desc":
            sortStage = { title: -1 };
            break;
          case "upvotes":
            sortStage = { upvoteCount: -1 };
            break;
          case "rating":
            sortStage = { averageRating: -1 };
            break;
          case "oldest":
            sortStage = { UploadDate: 1 };
            break;
          case "newest":
          default:
            sortStage = { UploadDate: -1 };
        }

        pipeline.push(
          { $sort: sortStage },
          { $skip: (parseInt(page) - 1) * parseInt(limit) },
          { $limit: parseInt(limit) }
        );

        const books = await booksCollection.aggregate(pipeline).toArray();
        const total = await booksCollection.countDocuments(match);

        res.send({
          books,
          pagination: {
            total,
            page: parseInt(page),
            limit: parseInt(limit),
            totalPages: Math.ceil(total / parseInt(limit)),
          },
        });
      } catch (error) {
        res.status(500).send({
          error: "Failed to fetch books",
          message: error.message,
        });
      }
    });

    // GET: Book genres for filtering
    app.get("/api/genres", async (req, res) => {
      try {
        const genres = await booksCollection.distinct("genre");
        res.send(genres.filter((g) => g));
      } catch (error) {
        res
          .status(500)
          .send({ error: "Failed to fetch genres", message: error.message });
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

    // GET: My books of a specific user
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

    // GET: Reviews for homepage
    app.get("/api/recent-reviews", async (req, res) => {
      try {
        const recentReviews = await booksCollection
          .aggregate([
            { $unwind: "$reviews" },
            { $sort: { "reviews.date": -1 } },
            { $limit: 10 },
            {
              $project: {
                _id: 0,
                bookId: "$_id",
                bookTitle: "$title",
                bookCover: "$cover",
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

    // GET: Top rated books
    app.get("/api/books/top/rated", async (req, res) => {
      try {
        const topBooks = await booksCollection
          .aggregate([
            { $match: { reviews: { $exists: true, $ne: [] } } },
            {
              $addFields: {
                averageRating: { $avg: "$reviews.rating" },
                reviewCount: { $size: "$reviews" },
              },
            },
            { $match: { reviewCount: { $gte: 1 } } },
            { $sort: { averageRating: -1, reviewCount: -1 } },
            { $limit: 6 },
          ])
          .toArray();
        res.send(topBooks);
      } catch (error) {
        res
          .status(500)
          .send({ error: "Failed to fetch top books", message: error.message });
      }
    });

    // GET: Most upvoted books
    app.get("/api/books/top/upvoted", async (req, res) => {
      try {
        const topBooks = await booksCollection
          .aggregate([
            {
              $addFields: {
                upvoteCount: { $size: { $ifNull: ["$upvotes", []] } },
              },
            },
            { $sort: { upvoteCount: -1 } },
            { $limit: 6 },
          ])
          .toArray();
        res.send(topBooks);
      } catch (error) {
        res
          .status(500)
          .send({
            error: "Failed to fetch upvoted books",
            message: error.message,
          });
      }
    });

    // GET: User statistics
    app.get(
      "/api/user/stats",
      verifyFirebaseToken,
      verifyTokenEmail,
      async (req, res) => {
        const email = req.query.email;
        try {
          // Books uploaded
          const uploadedCount = await booksCollection.countDocuments({
            "uploader.uploaderEmail": email,
          });

          // Reviews given
          const reviewsGiven = await booksCollection.countDocuments({
            "reviews.email": email,
          });

          // Books reading
          const readingBooks = await booksCollection.countDocuments({
            "readingStatus.email": email,
            "readingStatus.status": "Reading",
          });

          // Books completed
          const completedBooks = await booksCollection.countDocuments({
            "readingStatus.email": email,
            "readingStatus.status": "Completed",
          });

          res.send({
            uploadedBooks: uploadedCount,
            reviewsGiven,
            currentlyReading: readingBooks,
            completedBooks,
          });
        } catch (error) {
          res
            .status(500)
            .send({ error: "Failed to fetch stats", message: error.message });
        }
      }
    );

    // === READING GOALS FEATURE ===
    // POST: Create reading goal
    app.post("/api/reading-goals", verifyFirebaseToken, async (req, res) => {
      try {
        const goal = {
          ...req.body,
          createdAt: new Date(),
          progress: 0,
        };
        const result = await readingGoalsCollection.insertOne(goal);
        res.send(result);
      } catch (error) {
        res
          .status(500)
          .send({ error: "Failed to create goal", message: error.message });
      }
    });

    // GET: User's reading goals
    app.get(
      "/api/reading-goals",
      verifyFirebaseToken,
      verifyTokenEmail,
      async (req, res) => {
        const email = req.query.email;
        try {
          const goals = await readingGoalsCollection.find({ email }).toArray();
          res.send(goals);
        } catch (error) {
          res
            .status(500)
            .send({ error: "Failed to fetch goals", message: error.message });
        }
      }
    );

    // PATCH: Update reading goal progress
    app.patch(
      "/api/reading-goals/:id",
      verifyFirebaseToken,
      async (req, res) => {
        try {
          const id = req.params.id;
          const { progress } = req.body;
          const result = await readingGoalsCollection.updateOne(
            { _id: new ObjectId(id) },
            { $set: { progress, updatedAt: new Date() } }
          );
          res.send(result);
        } catch (error) {
          res
            .status(500)
            .send({ error: "Failed to update goal", message: error.message });
        }
      }
    );
    // DELETE: Remove a reading goal
    app.delete(
      "/api/reading-goals/:id",
      verifyFirebaseToken,
      async (req, res) => {
        try {
          const id = req.params.id;
          const result = await readingGoalsCollection.deleteOne({
            _id: new ObjectId(id),
          });

          if (result.deletedCount === 0) {
            return res.status(404).send({ error: "Goal not found" });
          }

          res.send({ success: true, message: "Goal deleted successfully" });
        } catch (error) {
          res
            .status(500)
            .send({ error: "Failed to delete goal", message: error.message });
        }
      }
    );

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
          $set: { ...updatedBook, updatedAt: new Date() },
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
          const result = await booksCollection.findOneAndUpdate(
            { _id: new ObjectId(bookId) },
            { $pull: { reviews: { email } } },
            { returnDocument: "after" }
          );

          if (!result.value) {
            return res.status(404).json({ error: "Review not found" });
          }

          res.status(200).json(result.value);
        } catch (error) {
          res
            .status(500)
            .json({ error: "Failed to delete review", message: error.message });
        }
      }
    );
  } catch (error) {
    console.log("❌ MongoDB connection error:", error);
  }
}

run().catch(console.dir);

// Default root route
app.get("/", (req, res) => {
  res.send(" Foliora Server is running s!");
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
