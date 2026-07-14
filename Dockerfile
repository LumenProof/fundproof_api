# Dockerfile

# Use an official Node.js runtime as a parent image
FROM node:18

# Set the working directory in the container
WORKDIR /usr/src/app

# Copy package.json and package-lock.json to the working directory
COPY package*.json ./

# Install app dependencies
RUN npm install

# Copy the rest of the application's code
COPY . .

# Build the NestJS application
RUN npm run build

# The port the app will be exposed on
EXPOSE 3000

# Command to run the application
CMD [ "node", "dist/main" ]