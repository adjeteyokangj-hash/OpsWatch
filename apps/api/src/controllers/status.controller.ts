import { Request, Response } from "express";
import { prisma } from "../lib/prisma";

export const getPublicStatus = async (req: Request, res: Response) => {
	const slug = typeof req.query.slug === "string" ? req.query.slug : undefined;
	const project = slug
		? await prisma.project.findUnique({ where: { slug }, include: { Service: true } })
		: null;

	if (!project && slug) {
		res.status(404).json({ error: "Project not found" });
		return;
	}

	res.json({
		status: project?.status ?? "HEALTHY",
		project: project
			? {
					id: project.id,
					slug: project.slug,
					name: project.name,
					status: project.status,
					services: project.Service.map((s) => ({ id: s.id, name: s.name, status: s.status }))
				}
			: null
	});
};

