-- A part can now be painted/lined on both sides of the tank (Internal and External). Additive only.
ALTER TYPE "PartSide" ADD VALUE IF NOT EXISTS 'BOTH';
