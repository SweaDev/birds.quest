# birds.quest spec 01

## The Main Goal

Auto blogging based on a bird watching session.

## The Big Picture

- The user will record GPS coordinates using a Traccar Client
- The VPS server will install Traccar Server and will receive and manage the GPS coordinates from the Traccar Client in a secure manner.
- The VPS server will also provide an interface for the user to view and manage the recorded GPS data.
- The Next.js application will get the recorded GPS session data from Traccar Server and set the data to be processed by a bird watched prediction script job queue.
- The bird watched prediction script will analyze the GPS session data (location and time of the year) and use Run BirdNET GeoModel (ONNX) to predict the bird species likely observed during the session.
- The prediction results of birds watched will be stored in the database.
- Then the script will use Wikipedia API to fetch additional information about the predicted bird species, along with images.
- Then the script will generate a blog post based on the prediction results (bird species likely observed during the session, along with collected images and additional information), but will not show any location related information.
- The auto generated blog post will be published on the next.js application - it'll read like what birds species anyone might have observed during a bird watching session had they took the users path.
- The user will be able to view and interact with the published blog posts on the Next.js application - like select / disselect the actual bird species they observed during the session, and then regenarate the blog post accordingly or write the markdown file manually in an appropriate side by side web based markdown editor.
- Gemma-4 open model will be used to produce the auto blog content based on the prediction results using DigitalOcean serverless inference API on the VPS server.
- On dev environment, Gemma-4 E2B model will be used to test the auto blogging functionality. Assume ollama with the Gemma-4 E2B model is installed and available for local inference.

## Security

- follow web app security best practices.

## Tech Stack

- use React + Next.js: find and install appropriate skill files first.
- use TypeScript.
- use `pnpm` as package manager. Assume installed already in the system.
- assume will be deployed on a single VPS server.
- once developed and tested locally, the app will be deployed on an Ubuntu 26.04 VPS server. Write appropriate server installation script for all production requirements.
- The changes to the next.js app will be deployed to the VPS server using Git push workflow. The VPS server will have a bare repo, and a post-receive hook will be set up to automatically update the working directory and restart the application.
- Use Caddy as a reverse proxy and for managing SSL certificates.

## References
- Traccar Client: https://www.traccar.org/client/
- Traccar VPS Installation: https://www.traccar.org/install-vps/
- Securing Traccar Server: https://www.traccar.org/secure-connection/
- Traccar Documentation: https://www.traccar.org/documentation/
- Traccar MySQL Setup: https://www.traccar.org/mysql/
- Run BirdNET GeoModel (ONNX): https://birdnet-team.github.io/geomodel/
- DigitalOcean serverless API endpoint: https://docs.digitalocean.com/products/inference/how-to/si-endpoints/
- DigitalOcean serverless inference API documentation: https://docs.digitalocean.com/reference/api/reference/serverless-inference/
- Official DigitalOcean Typescript Client based on the DO OpenAPIv3 specification: https://github.com/digitalocean/dots
- Wikipedia API documentation: [https://en.wikipedia.org/api/rest_v1/page/summary/](https://en.wikipedia.org/api/rest_v1/page/summary/){Title_or_Scientific_Name}