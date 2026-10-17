require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const { getYoutubeStatus, uploadToYoutube } = require('./youtubeService');

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/output', express.static(path.join(__dirname, 'output')));

app.get('/api/youtube/status', async (req,res)=>{
  try{ res.json(await getYoutubeStatus()); }catch(e){ res.json({connected:false, error:e.message}) }
});

app.post('/api/youtube/upload', async (req,res)=>{
  try{
    const result = await uploadToYoutube(req.body);
    res.json(result);
  }catch(e){ res.status(500).json({error:e.message}) }
});

const { autoGenerateAndUpload } = require('./autoPoster');
app.post('/api/auto/high-quality', async (req,res)=>{
  try{
    const r = await autoGenerateAndUpload();
    res.json(r);
  }catch(e){
    console.error(e);
    res.status(500).json({error:e.message});
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Nour Quran app running at http://localhost:${PORT}`);
});