FROM node:18-alpine3.17

# Install python3, pip, ffmpeg (required dependencies)
RUN apk add --no-cache python3 py3-pip ffmpeg

# Install yt-dlp via pip
RUN pip3 install yt-dlp

# Set working directory
WORKDIR /app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install node dependencies
RUN npm install

# Copy rest of backend source code
COPY . .

# Expose backend port
EXPOSE 3000

# Start backend server
CMD ["node", "index.js"]
