
const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const path = require('path');
const http = require('http');
const socketIo = require('socket.io');
const multer = require('multer');
const fs = require('fs');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// MongoDB Connection
const MONGODB_URI = "mongodb://abhi:4JMrp4Ah2IfjRQ_M6rDWjwO0wxt5sHy4_L9d6XCMm1y4ln9O@41afff42-d2ba-49ba-b89f-b3e3aacefa04.asia-south1.firestore.goog:443/infinitelearning?loadBalanced=true&authMechanism=SCRAM-SHA-256&tls=true&retryWrites=false";

mongoose.connect(MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true })
    .then(() => console.log(`✅ Connected to MongoDB at ${MONGODB_URI}`))
    .catch(err => console.error('❌ MongoDB connection error:', err));

// User Schema
const userSchema = new mongoose.Schema({
    fullName: { type: String, required: true },
    branch: { type: String, required: true },
    year: { type: Number, required: true },
    rollNo: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    isOnline: { type: Boolean, default: false },
    lastSeen: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);

// Message Schema
const messageSchema = new mongoose.Schema({
    sender: { type: String, required: true },
    receiver: { type: String, required: true },
    message: { type: String, required: true },
    timestamp: { type: Date, default: Date.now },
    read: { type: Boolean, default: false }
});

const Message = mongoose.model('Message', messageSchema);

// Serve Homepage
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Signup Route
app.post('/api/signup', async (req, res) => {
    try {
        console.log('📩 Signup request received:', req.body);

        // Accept both old and new keys to remain backward-compatible
        const fullName = req.body.fullName || req.body.firstName || '';
        const branch = req.body.branch || req.body.lastName || '';
        // year may come as number or string; handle both old 'year' and new 'age'
        const year = (req.body.year !== undefined && req.body.year !== null) ? req.body.year :
                     (req.body.age !== undefined && req.body.age !== null) ? req.body.age : undefined;
        // rollNo fallback: check rollNo or rollNumber, otherwise try to derive from email local-part
        const rollNo = req.body.rollNo || req.body.rollNumber || (req.body.email ? String(req.body.email).split('@')[0] : 'unknown');
        const email = req.body.email || req.body.signupEmail || '';
        const password = req.body.password;

        if (!email || !password) {
            console.log('⚠ Missing required signup fields.');
            return res.status(400).json({ message: 'Email and password are required' });
        }

        if (await User.findOne({ email })) {
            console.log('⚠ User already exists:', email);
            return res.status(400).json({ message: 'User already exists' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        // Ensure we pass valid DB fields: fullName, branch, year (number), rollNo, email, password
        const newUser = new User({
            fullName: fullName || email.split('@')[0], // fallback to email local-part if fullName missing
            branch: branch || '',
            year: year !== undefined ? Number(year) : 0,
            rollNo,
            email,
            password: hashedPassword
        });

        await newUser.save();

        console.log('✅ User created successfully:', email);
        res.status(201).json({ message: 'User created successfully' });
    } catch (error) {
        console.error('❌ Error in signup:', error);
        res.status(500).json({ message: 'Error creating user', error: error.message });
    }
});


// Signin Route
app.post('/api/signin', async (req, res) => {
    try {
        console.log('🔑 Signin request received:', req.body);

        const { email, password } = req.body;
        const user = await User.findOne({ email });

        if (!user) {
            console.log('❌ User not found:', email);
            return res.status(400).json({ message: 'User not found' });
        }

        if (!(await bcrypt.compare(password, user.password))) {
            console.log('⚠ Invalid password for:', email);
            return res.status(400).json({ message: 'Invalid credentials' });
        }

        // Update user online status
        await User.updateOne({ email }, { isOnline: true, lastSeen: new Date() });

        console.log('✅ Login successful:', email);
        res.json({ 
            message: 'Login successful',
            user: {
                fullName: user.fullName,
                email: user.email,
                branch: user.branch,
                year: user.year,
                rollNo: user.rollNo
            }
        });
    } catch (error) {
        console.error('❌ Error in signin:', error);
        res.status(500).json({ message: 'Error signing in', error: error.message });
    }
});

// Get user profile
app.get('/api/user/:email', async (req, res) => {
    try {
        const lookupEmail = req.params.email;
        const user = await User.findOne({ email: lookupEmail });

        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        // Return both old-style and new-style keys to keep frontend flexible
        const userObj = user.toObject ? user.toObject() : user;
        const mapped = {
            // original DB fields
            fullName: userObj.fullName,
            branch: userObj.branch,
            year: userObj.year,
            rollNo: userObj.rollNo,
            email: userObj.email,
            // additional friendly keys for new frontend
            firstName: userObj.firstName || userObj.fullName || '',
            lastName: userObj.lastName || userObj.branch || '',
            age: (userObj.age !== undefined && userObj.age !== null) ? userObj.age : userObj.year,
        };

        res.json(mapped);
    } catch (error) {
        console.error('Error fetching user:', error);
        res.status(500).json({ message: 'Server error' });
    }
});


// Update profile
app.put('/api/update-profile', async (req, res) => {
    try {
        // Accept both old and new keys
        const fullName = req.body.fullName || req.body.firstName;
        const branch = req.body.branch || req.body.lastName;
        const year = (req.body.year !== undefined && req.body.year !== null) ? req.body.year :
                     (req.body.age !== undefined && req.body.age !== null) ? req.body.age : undefined;
        // rollNo could be provided or the email might be the roll field in older design
        const rollNo = req.body.rollNo || req.body.rollNumber || undefined;
        const email = req.body.email; // email is required for lookup
        const password = req.body.password;

        if (!email) {
            return res.status(400).json({ message: 'Email is required to update profile' });
        }

        const user = await User.findOne({ email });

        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        // Build updatedFields only with provided values (so partial updates work)
        const updatedFields = {};
        if (fullName !== undefined) updatedFields.fullName = fullName;
        if (branch !== undefined) updatedFields.branch = branch;
        if (year !== undefined) updatedFields.year = Number(year);
        if (rollNo !== undefined) updatedFields.rollNo = rollNo;

        if (password) {
            updatedFields.password = await bcrypt.hash(password, 10);
        }

        // If nothing to update
        if (Object.keys(updatedFields).length === 0) {
            return res.status(400).json({ message: 'No valid fields provided to update' });
        }

        await User.updateOne({ email }, { $set: updatedFields });

        console.log('✅ User profile updated successfully for', email);
        res.json({ message: 'Profile updated successfully' });

    } catch (error) {
        console.error('❌ Error updating profile:', error);
        res.status(500).json({ message: 'Error updating profile', error: error.message });
    }
});


// Send message endpoint for collaboration
app.post('/api/send-message', async (req, res) => {
    try {
        const { senderEmail, receiverEmail, message } = req.body;
        
        // Validate required fields
        if (!senderEmail || !receiverEmail || !message) {
            return res.status(400).json({ error: 'All fields are required' });
        }
        
        // Create new message
        const newMessage = new Message({
            sender: senderEmail,
            receiver: receiverEmail,
            message: message,
            timestamp: new Date(),
            read: false
        });
        
        // Save message to database
        await newMessage.save();
        
        // Send real-time notification if receiver is online
        const receiverSocketId = connectedUsers.get(receiverEmail);
        if (receiverSocketId) {
            io.to(receiverSocketId).emit('receive-message', {
                sender: senderEmail,
                receiver: receiverEmail,
                message: message,
                timestamp: newMessage.timestamp
            });
        }
        
        console.log(`💬 Collaboration message sent from ${senderEmail} to ${receiverEmail}`);
        res.json({ success: true, message: 'Message sent successfully' });
        
    } catch (error) {
        console.error('❌ Error sending collaboration message:', error);
        res.status(500).json({ error: 'Failed to send message' });
    }
});

// Get all users for messaging
app.get('/api/users', async (req, res) => {
    try {
        const users = await User.find({}, 'fullName email isOnline lastSeen');
        res.json(users);
    } catch (error) {
        console.error('Error fetching users:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Get messages between two users
app.get('/api/messages/:sender/:receiver', async (req, res) => {
    try {
        const { sender, receiver } = req.params;
        const messages = await Message.find({
            $or: [
                { sender, receiver },
                { sender: receiver, receiver: sender }
            ]
        }).sort({ timestamp: 1 });

        res.json(messages);
    } catch (error) {
        console.error('Error fetching messages:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Socket.io connection handling
const connectedUsers = new Map();

io.on('connection', (socket) => {
    console.log('👤 User connected:', socket.id);

    // User joins with their email
    socket.on('user-connected', async (email) => {
        connectedUsers.set(email, socket.id);
        socket.email = email;
        
        // Update user online status
        await User.updateOne({ email }, { isOnline: true, lastSeen: new Date() });
        
        // Broadcast to all users that this user is online
        socket.broadcast.emit('user-online', email);
        
        console.log(`✅ User ${email} connected`);
    });

    // Handle sending messages
    socket.on('send-message', async (data) => {
        try {
            const { sender, receiver, message } = data;
            
            // Save message to database
            const newMessage = new Message({
                sender,
                receiver,
                message,
                timestamp: new Date()
            });
            
            await newMessage.save();
            
            // Send to receiver if online
            const receiverSocketId = connectedUsers.get(receiver);
            if (receiverSocketId) {
                io.to(receiverSocketId).emit('receive-message', {
                    sender,
                    receiver,
                    message,
                    timestamp: newMessage.timestamp
                });
            }
            
            // Send back to sender for confirmation
            socket.emit('message-sent', {
                sender,
                receiver,
                message,
                timestamp: newMessage.timestamp
            });
            
            console.log(`💬 Message sent from ${sender} to ${receiver}`);
        } catch (error) {
            console.error('❌ Error sending message:', error);
            socket.emit('message-error', { error: 'Failed to send message' });
        }
    });

    // Handle user disconnect
    socket.on('disconnect', async () => {
        if (socket.email) {
            connectedUsers.delete(socket.email);
            
            // Update user offline status
            await User.updateOne({ email: socket.email }, { 
                isOnline: false, 
                lastSeen: new Date() 
            });
            
            // Broadcast to all users that this user is offline
            socket.broadcast.emit('user-offline', socket.email);
            
            console.log(`👋 User ${socket.email} disconnected`);
        }
    });
});

// Add these routes to your existing server.js file

// Get unread message counts for a user
app.get('/api/unread-counts/:userEmail', async (req, res) => {
    try {
        const userEmail = req.params.userEmail;
        
        const unreadCounts = await Message.aggregate([
            {
                $match: {
                    receiver: userEmail,
                    read: false
                }
            },
            {
                $group: {
                    _id: '$sender',
                    count: { $sum: 1 }
                }
            }
        ]);
        
        // Convert to object format
        const unreadObj = {};
        unreadCounts.forEach(item => {
            unreadObj[item._id] = item.count;
        });
        
        res.json(unreadObj);
    } catch (error) {
        console.error('Error fetching unread counts:', error);
        res.status(500).json({ error: 'Failed to fetch unread counts' });
    }
});

// Mark messages as read
app.post('/api/mark-read', async (req, res) => {
    try {
        const { receiver, sender } = req.body;
        
        await Message.updateMany(
            {
                receiver: receiver,
                sender: sender,
                read: false
            },
            {
                $set: { read: true }
            }
        );
        
        res.json({ success: true });
    } catch (error) {
        console.error('Error marking messages as read:', error);
        res.status(500).json({ error: 'Failed to mark messages as read' });
    }
});


// Get last message times for sorting users
app.get('/api/last-message-times/:userEmail', async (req, res) => {
    try {
        const userEmail = req.params.userEmail;
        
        const lastMessages = await Message.aggregate([
            {
                $match: {
                    $or: [
                        { sender: userEmail },
                        { receiver: userEmail }
                    ]
                }
            },
            {
                $sort: { timestamp: -1 }
            },
            {
                $group: {
                    _id: {
                        $cond: [
                            { $eq: ['$sender', userEmail] },
                            '$receiver',
                            '$sender'
                        ]
                    },
                    lastMessageTime: { $first: '$timestamp' }
                }
            }
        ]);
        
        // Convert to object format
        const lastMessageTimes = {};
        lastMessages.forEach(item => {
            lastMessageTimes[item._id] = item.lastMessageTime;
        });
        
        res.json(lastMessageTimes);
    } catch (error) {
        console.error('Error fetching last message times:', error);
        res.status(500).json({ error: 'Failed to fetch last message times' });
    }
});

// Get total unread count for a user (for home page notification)
app.get('/api/total-unread/:userEmail', async (req, res) => {
    try {
        const userEmail = req.params.userEmail;
        
        const totalUnread = await Message.countDocuments({
            receiver: userEmail,
            read: false
        });
        
        res.json({ totalUnread });
    } catch (error) {
        console.error('Error fetching total unread count:', error);
        res.status(500).json({ error: 'Failed to fetch total unread count' });
    }
});

// Start Server
//const PORT = process.env.PORT || 5000;
//server.listen(PORT, () => {
  //console.log(`Server running on port ${PORT}`);
//});


// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'uploads/');
    },
    filename: function (req, file, cb) {
        // Generate unique filename
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({ 
    storage: storage,
    limits: {
        fileSize: 5 * 1024 * 1024 // 5MB limit
    },
    fileFilter: function (req, file, cb) {
        // Check if file is an image
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Only image files are allowed!'), false);
        }
    }
});

// Serve uploaded files statically
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// MongoDB schemas for new collections
const collaborationPostSchema = new mongoose.Schema({
    title: { type: String, required: true },
    technologies: { type: String, required: true },
    description: { type: String, required: true },
    vacancies: { type: Number, required: true },
    image: { type: String, required: true },
    userEmail: { type: String, required: true },
    createdAt: { type: Date, default: Date.now }
});

const alumniPostSchema = new mongoose.Schema({
    title: { type: String, required: true },
    developers: { type: String, required: true },
    image: { type: String, required: true },
    userEmail: { type: String, required: true },
    createdAt: { type: Date, default: Date.now }
});

const CollaborationPost = mongoose.model('CollaborationPost', collaborationPostSchema);
const AlumniPost = mongoose.model('AlumniPost', alumniPostSchema);

// API Routes for Collaboration Posts
app.post('/api/collaboration-posts', upload.single('image'), async (req, res) => {
    try {
        const { title, technologies, description, vacancies, userEmail } = req.body;
        
        if (!req.file) {
            return res.status(400).json({ error: 'Image is required' });
        }

        const newPost = new CollaborationPost({
            title,
            technologies,
            description,
            vacancies: parseInt(vacancies),
            image: req.file.filename,
            userEmail
        });

        await newPost.save();
        res.status(201).json({ message: 'Post created successfully', post: newPost });
    } catch (error) {
        console.error('Error creating collaboration post:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

app.get('/api/collaboration-posts', async (req, res) => {
    try {
        const posts = await CollaborationPost.find().sort({ createdAt: -1 });
        res.json(posts);
    } catch (error) {
        console.error('Error fetching collaboration posts:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Delete collaboration post
app.delete('/api/collaboration-posts/:id', async (req, res) => {
    try {
        const postId = req.params.id;
        
        // Find and delete the post
        const deletedPost = await CollaborationPost.findByIdAndDelete(postId);
        
        if (!deletedPost) {
            return res.status(404).json({ error: 'Post not found' });
        }
        
        // Delete the associated image file
        const imagePath = path.join(__dirname, 'uploads', deletedPost.image);
        if (fs.existsSync(imagePath)) {
            fs.unlinkSync(imagePath);
        }
        
        console.log('✅ Post deleted successfully:', postId);
        res.json({ message: 'Post deleted successfully' });
    } catch (error) {
        console.error('❌ Error deleting post:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// API Routes for Alumni Posts
app.post('/api/alumni-posts', upload.single('image'), async (req, res) => {
    try {
        const { title, developers, userEmail } = req.body;
        
        if (!req.file) {
            return res.status(400).json({ error: 'Image is required' });
        }

        const newPost = new AlumniPost({
            title,
            developers,
            image: req.file.filename,
            userEmail
        });

        await newPost.save();
        res.status(201).json({ message: 'Alumni post created successfully', post: newPost });
    } catch (error) {
        console.error('Error creating alumni post:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

app.get('/api/alumni-posts', async (req, res) => {
    try {
        const posts = await AlumniPost.find().sort({ createdAt: -1 });
        res.json(posts);
    } catch (error) {
        console.error('Error fetching alumni posts:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Error handling middleware for multer
app.use((error, req, res, next) => {
    if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ error: 'File too large' });
        }
    }
    next(error);
});

// Start Server
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
